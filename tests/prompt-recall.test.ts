import test from "node:test";
import assert from "node:assert/strict";
import { recallStep } from "../src/lib/prompt-recall.ts";

test("↑/↓ walk sent prompts from an empty composer and restore the draft", () => {
  const sent = ["a", "b", "c"];
  assert.equal(recallStep(sent, { index: null, draft: "" }, "typing", -1), null, "a draft in progress is never replaced");
  let step = recallStep(sent, { index: null, draft: "" }, "", -1)!;
  assert.equal(step.value, "c");
  step = recallStep(sent, step.state, step.value, -1)!;
  assert.equal(step.value, "b");
  step = recallStep(sent, step.state, step.value, -1)!;
  step = recallStep(sent, step.state, step.value, -1)!;
  assert.equal(step.value, "a", "stays on the oldest");
  step = recallStep(sent, step.state, step.value, 1)!;
  step = recallStep(sent, step.state, step.value, 1)!;
  step = recallStep(sent, step.state, step.value, 1)!;
  assert.deepEqual(step, { state: { index: null, draft: "" }, value: "" }, "past the newest the empty draft returns");
  assert.equal(recallStep([], { index: null, draft: "" }, "", -1), null);
});
