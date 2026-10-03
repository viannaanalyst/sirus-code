import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTranscript, parseUnifiedDiff } from "../src/lib/transcript.ts";

test("streaming fences preserve incomplete code and treat HTML as plain text", () => {
  assert.deepEqual(parseTranscript("<script>unsafe</script>\n```ts\nconst value = 1;"), [
    { kind: "text", content: "<script>unsafe</script>" },
    { kind: "code", content: "const value = 1;", language: "ts" },
  ]);
});
test("longer fences can contain shorter fences and resume prose", () => {
  assert.deepEqual(parseTranscript("````md\n```\n````\nDone"), [
    { kind: "code", content: "```", language: "md" }, { kind: "text", content: "Done" },
  ]);
});
test("diff line numbers follow hunks and never classify file headers as changes", () => {
  const lines = parseUnifiedDiff("--- a/file\n+++ b/file\n@@ -3,2 +3,2 @@\n context\n-before\n+after\n\\ No newline at end of file\n");
  assert.equal(lines[1].kind, "header");
  assert.deepEqual(lines.slice(3, 6).map(({ kind, oldLine, newLine }) => ({ kind, oldLine, newLine })), [
    { kind: "context", oldLine: 3, newLine: 3 }, { kind: "deletion", oldLine: 4, newLine: null }, { kind: "addition", oldLine: null, newLine: 4 },
  ]);
  assert.equal(lines[6].kind, "header");
});
