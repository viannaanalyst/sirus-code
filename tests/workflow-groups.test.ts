import assert from "node:assert/strict";
import { test } from "node:test";
import { memberAnswer, workflowGroups } from "../src/lib/workflow-groups.ts";

test("workflow members group under their phases with each phase's state", () => {
  const groups = workflowGroups({
    name: "review",
    phases: [{ index: 1, title: "Read" }, { index: 2, title: "Write" }, { index: 3, title: "Check" }],
    agents: [
      { index: 1, label: "a", state: "completed", phaseIndex: 1 },
      { index: 2, label: "b", state: "failed", phaseIndex: 1 },
      { index: 3, label: "c", state: "running", phaseIndex: 2 },
      { index: 4, label: "d", state: "queued", phaseIndex: 2 },
      { index: 5, label: "e", state: "queued" },
    ],
  });
  assert.deepEqual(groups.map((group) => [group.title, group.state, group.settled, group.members.length]), [
    ["Read", "failed", 2, 2],
    ["Write", "running", 0, 2],
    ["Check", "pending", 0, 0],
    [null, "pending", 0, 1],
  ]);
});

test("a running member shows its answer so far, which the final result replaces", () => {
  assert.deepEqual(memberAnswer({ index: 1, label: "a", state: "running", partial: " Reading the tests " }), { text: "Reading the tests", final: false });
  assert.equal(memberAnswer({ index: 1, label: "a", state: "running", result: "stale" }), null);
  assert.equal(memberAnswer({ index: 1, label: "a", state: "running", partial: "  " }), null);
  assert.equal(memberAnswer({ index: 1, label: "a", state: "queued", partial: "x" }), null);
  assert.deepEqual(memberAnswer({ index: 1, label: "a", state: "completed", partial: "so far", result: "Done: 3 bugs" }), { text: "Done: 3 bugs", final: true });
  assert.equal(memberAnswer({ index: 1, label: "a", state: "failed", partial: "so far" }), null);
});
