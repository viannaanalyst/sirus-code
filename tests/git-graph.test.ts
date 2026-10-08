import { test } from "node:test";
import assert from "node:assert/strict";
import { graphCommitFromDecorations, historyItemGraph, HISTORY_ITEM_REF_COLOR, layoutGitGraph } from "../src/lib/git-graph.ts";

test("decorations become the head flag and typed refs", () => {
  const commit = graphCommitFromDecorations("a", ["b"], ["HEAD -> main", "origin/main", "origin/HEAD", "tag: v1.0"]);
  assert.equal(commit.head, true);
  assert.deepEqual(commit.refs, [{ name: "main", kind: "local" }, { name: "origin/main", kind: "remote" }, { name: "v1.0", kind: "tag" }]);
});

test("a merge opens a second lane that rejoins, and HEAD takes the current-branch colour", () => {
  const rows = layoutGitGraph([
    graphCommitFromDecorations("m", ["a", "f"], ["HEAD -> main"]),
    graphCommitFromDecorations("f", ["a"], []),
    graphCommitFromDecorations("a", [], []),
  ]);
  assert.equal(rows[0].kind, "HEAD");
  assert.equal(rows[0].outputSwimlanes.length, 2);
  assert.equal(rows[2].inputSwimlanes.length, 2);
  const head = historyItemGraph(rows[0]);
  assert.equal(head.circleColor, HISTORY_ITEM_REF_COLOR);
  assert.equal(head.circles.length, 2);
  assert.ok(historyItemGraph(rows[1]).width >= 33);
});
