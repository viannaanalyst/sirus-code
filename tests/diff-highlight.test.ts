import assert from "node:assert/strict";
import test from "node:test";
import { DiffHighlighter, diffSegments, segmentOf, segmentPayload, splitByTokens, tokenizeSegment, DIFF_SEGMENT_LINES } from "../src/lib/diff-highlight.ts";
import { languageForPath, TOKEN_KINDS } from "../src/lib/code-tokens.ts";
import { reviewDiffLines } from "../src/lib/diff-comment.ts";

const kinds = (tokens: Uint32Array, text: string) => {
  const out: string[] = [];
  for (let index = 0; index < tokens.length; index += 3) out.push(`${TOKEN_KINDS[tokens[index + 2]]}:${text.slice(tokens[index], tokens[index + 1])}`);
  return out;
};

test("segments start at hunks and are capped in size", () => {
  const lines = reviewDiffLines(`--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n a\n+b\n@@ -9 +9 @@\n-c\n`);
  assert.deepEqual([...diffSegments(lines)], [0, 5]);
  assert.equal(segmentOf(diffSegments(lines), 4), 0);
  assert.equal(segmentOf(diffSegments(lines), 6), 1);
  const long = reviewDiffLines(`@@ -0,0 +1,900 @@\n${Array.from({ length: 900 }, (_, i) => `+v${i}`).join("\n")}\n`);
  assert.deepEqual([...diffSegments(long)], [0, DIFF_SEGMENT_LINES, 2 * DIFF_SEGMENT_LINES]);
  assert.equal(diffSegments(long), diffSegments(long), "cached per parsed diff");
});

test("each side is tokenized as source, so comments spanning lines colour every line", () => {
  const lines = reviewDiffLines("@@ -1,3 +1,3 @@\n const a = 1;\n-/* old */\n+/* new\n+ still comment */ return\n");
  const payload = segmentPayload(lines, 0, lines.length);
  assert.deepEqual([...payload.sides], [0, 3, 1, 2, 2]);
  const result = tokenizeSegment(payload, "ts");
  const line = (index: number) => kinds(result.tokens.subarray(result.starts[index], result.starts[index + 1]), payload.texts[index]);
  assert.deepEqual(line(0), [], "the hunk header is not code");
  assert.deepEqual(line(1), ["keyword:const", "punctuation:=", "number:1", "punctuation:;"]);
  assert.deepEqual(line(2), ["comment:/* old */"], "the old side has its own comment");
  assert.deepEqual(line(3), ["comment:/* new"]);
  assert.deepEqual(line(4), ["comment: still comment */", "keyword:return"]);
});

test("rows split into coloured pieces after the marker column", () => {
  const tokens = Uint32Array.of(0, 5, TOKEN_KINDS.indexOf("keyword"));
  assert.deepEqual(splitByTokens("+const x", tokens, 1), [{ text: "+", kind: null }, { text: "const", kind: "keyword" }, { text: " x", kind: null }]);
  assert.deepEqual(splitByTokens("plain", undefined), [{ text: "plain", kind: null }]);
  assert.deepEqual(splitByTokens("ab", Uint32Array.of(5, 9, 0)), [{ text: "ab", kind: null }], "out-of-range tokens are ignored");
});

test("only source files are coloured", () => {
  assert.equal(languageForPath("src/app.tsx"), "tsx");
  assert.equal(languageForPath("src-tauri/src/main.rs"), "rs");
  assert.equal(languageForPath("README.md"), null);
  assert.equal(languageForPath("Makefile"), null);
  assert.equal(languageForPath(".env"), null);
});

test("the highlighter sends visible segments first, drops stale work and keeps results", async () => {
  const posted: { id: number; texts: string[] }[] = [];
  let worker: { onmessage: ((event: MessageEvent) => void) | null; onerror: (() => void) | null; postMessage: (data: { id: number; language: string; payload: { texts: string[]; sides: Uint8Array } }) => void; terminate: () => void } | null = null;
  const highlighter = new DiffHighlighter(() => {
    worker = { onmessage: null, onerror: null, postMessage: (data) => posted.push({ id: data.id, texts: data.payload.texts }), terminate: () => {} };
    return worker as unknown as Worker;
  });
  const lines = reviewDiffLines(`@@ -0,0 +1,2000 @@\n${Array.from({ length: 2000 }, (_, i) => `+const v${i} = ${i};`).join("\n")}\n`);
  let painted = 0;
  highlighter.subscribe(() => { painted++; });
  highlighter.want([{ lines, language: "ts", from: 900, to: 960 }]);
  assert.equal(posted.length, 1, "one job at a time");
  assert.equal(posted[0].texts[0], "const v799 = 799;", "the segment holding the visible rows goes first");
  // Scrolling elsewhere replaces the queue; the job in flight still lands.
  highlighter.want([{ lines, language: "ts", from: 10, to: 40 }]);
  const reply = tokenizeSegment(segmentPayload(lines, 800, 1200), "ts");
  worker!.onmessage!({ data: { id: posted[0].id, result: reply } } as MessageEvent);
  assert.equal(posted.length, 2);
  assert.equal(posted[1].texts[1], "const v0 = 0;");
  const tokens = highlighter.tokensFor(lines, 901);
  assert.ok(tokens && tokens.length > 0);
  assert.equal(highlighter.tokensFor(lines, 901), tokens, "stable per line, so memoized rows stay put");
  assert.equal(highlighter.tokensFor(lines, 10), undefined, "plain until its segment arrives");
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(painted, 1);
  // A broken worker turns colours off instead of retrying forever.
  worker!.onerror!();
  assert.equal(highlighter.available, false);
  assert.equal(new DiffHighlighter(null).available, false);
});
