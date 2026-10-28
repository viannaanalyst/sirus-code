import assert from "node:assert/strict";
import { test } from "node:test";
import { completeComposerCommand, completeComposerToken, composerTrigger, suggestionIndex } from "../src/lib/composer-suggestions.ts";

test("composer detects slash and file tokens at the caret, including quoted directories", () => {
  assert.deepEqual(composerTrigger("/", 1), { kind: "skill", query: "", start: 0, end: 1 });
  assert.deepEqual(composerTrigger("fix @src/Agent", 14), { kind: "file", query: "src/Agent", start: 4, end: 14 });
  assert.equal(composerTrigger('see @"my folder/', 16)?.query, "my folder/");
  assert.deepEqual(composerTrigger("/review later", 4), { kind: "skill", query: "rev", start: 0, end: 7 });
  for (const text of ["https://", "me@example.com", "src/file", "hello /review ", '@"done.md" ']) {
    assert.equal(composerTrigger(text, text.length), null, text);
  }
  assert.equal(composerTrigger("/review", 0, 7), null);
});

test("completion preserves the draft suffix and provides a caret without sending", () => {
  const value = "fix @src/A later";
  const trigger = composerTrigger(value, 10)!;
  assert.deepEqual(completeComposerToken(value, trigger, "src/Agent.tsx"), { value: "fix @src/Agent.tsx later", caret: 18 });
  assert.deepEqual(completeComposerToken("/rev later", composerTrigger("/rev later", 4)!, "review"), { value: "/review later", caret: 7 });
  // A skill chosen mid-sentence stays where it was typed; native admission reads it anywhere.
  assert.equal(completeComposerToken("fix /rev", composerTrigger("fix /rev", 8)!, "review").value, "fix /review ");
  assert.equal(completeComposerToken("/review /lo task", composerTrigger("/review /lo task", 11)!, "local").value, "/review /local task");
});

test("file completion quotes spaces and leaves directory browsing active", () => {
  const trigger = composerTrigger("@", 1)!;
  assert.equal(completeComposerToken("@", trigger, "notes file.md").value, '@"notes file.md" ');
  const directory = completeComposerToken("@", trigger, "my folder", true);
  assert.equal(directory.value, '@"my folder/');
  assert.equal(composerTrigger(directory.value, directory.caret)?.query, "my folder/");
  const next = completeComposerToken(directory.value, composerTrigger(directory.value, directory.caret)!, "my folder/file.md");
  assert.equal(next.value, '@"my folder/file.md" ');
  assert.equal(composerTrigger(next.value, next.caret), null);
  const quoted = completeComposerToken("@", trigger, 'my "folder"@home', true);
  assert.equal(composerTrigger(quoted.value, quoted.caret)?.query, 'my "folder"@home/');
});

test("keyboard navigation wraps and handles an empty result", () => {
  assert.equal(suggestionIndex(0, -1, 3), 2);
  assert.equal(suggestionIndex(2, 1, 3), 0);
  assert.equal(suggestionIndex(0, 1, 0), 0);
});

test("composer highlights standalone skill invocations and file mentions, not paths", async () => {
  const { composerSegments, hasComposerTokens } = await import("../src/lib/composer-tokens.ts");
  assert.deepEqual(composerSegments("fix /graphify with @docs/a.md now").map((s) => [s.kind, s.text]), [["text", "fix "], ["skill", "/graphify"], ["text", " with "], ["file", "@docs/a.md"], ["text", " now"]]);
  assert.deepEqual(composerSegments('see @"my file.md" and /usr/bin').filter((s) => s.kind !== "text").map((s) => s.text), ['@"my file.md"']);
  assert.equal(hasComposerTokens("plain text"), false);
});

test("Tab on an app command only writes its name, leaving the list open for Enter to run it", () => {
  const next = completeComposerCommand("/re", composerTrigger("/re", 3)!, "review");
  assert.deepEqual(next, { value: "/review", caret: 7 });
  // The caret stays on the token, so the `/` list is still offered with the command's own row.
  assert.deepEqual(composerTrigger(next.value, next.caret), { kind: "skill", query: "review", start: 0, end: 7 });
  assert.deepEqual(completeComposerCommand("/co later", composerTrigger("/co later", 3)!, "compact"), { value: "/compact later", caret: 8 });
});
