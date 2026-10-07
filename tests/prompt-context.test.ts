import test from "node:test";
import assert from "node:assert/strict";
import { splitPromptContext, withPromptContext } from "../src/lib/prompt-context.ts";

test("a sent prompt shows the request and its attachments, not the reference block", () => {
  const sent = withPromptContext("aonde eu escolho?", [{ label: 'Selected file: "CleanShot 2026-10-06 at 22.56.20@2x.jpg"', content: "" }, { label: 'Selected folder: "docs"', content: "a.md" }]);
  assert.deepEqual(splitPromptContext(sent), { request: "aonde eu escolho?", references: [{ kind: "file", name: "CleanShot 2026-10-06 at 22.56.20@2x.jpg" }, { kind: "folder", name: "docs" }] });
  assert.deepEqual(splitPromptContext("só texto"), { request: "só texto", references: [] });
});
