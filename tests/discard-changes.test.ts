import { test } from "node:test";
import assert from "node:assert/strict";
import { discardPlan, discardSteps } from "../src/lib/discard-changes.ts";
import type { GitWorkspaceEntry } from "../src/client/types.ts";

const entry = (path: string, kind: GitWorkspaceEntry["kind"], actionable = true): GitWorkspaceEntry => ({ path, kind, conflicted: false, actionable });

test("each kind of change gets the command the native side runs", () => {
  assert.deepEqual(discardSteps(null, "modified"), ["restoreWorktree"]);
  assert.deepEqual(discardSteps(null, "deleted"), ["restoreWorktree"]);
  assert.deepEqual(discardSteps(null, "untracked"), ["deleteFile"]);
  assert.deepEqual(discardSteps("modified", null), ["restoreStaged", "restoreWorktree"]);
  assert.deepEqual(discardSteps("deleted", "modified"), ["restoreStaged", "restoreWorktree"]);
  assert.deepEqual(discardSteps("added", null), ["removeFromIndex", "deleteFile"]);
  assert.deepEqual(discardSteps("added", "modified"), ["removeFromIndex", "deleteFile"]);
});

test("renames and mixed untracked/staged paths are refused, not guessed", () => {
  assert.equal(discardSteps("renamed", null), null);
  assert.equal(discardSteps("deleted", "untracked"), null);
  assert.equal(discardSteps(null, null), null);
});

test("a plan counts the files that will be deleted from disk", () => {
  const staged = [entry("new.ts", "added"), entry("kept.ts", "modified")];
  const unstaged = [entry("new.ts", "modified"), entry("loose.md", "untracked"), entry("kept.ts", "modified")];
  const plan = discardPlan(["new.ts", "kept.ts", "loose.md"], staged, unstaged);
  assert.ok(plan);
  assert.equal(plan.deletes, 2);
  assert.deepEqual(plan.files.map(file => file.path), ["new.ts", "kept.ts", "loose.md"]);
  assert.deepEqual(plan.files[1].steps, ["restoreStaged", "restoreWorktree"]);
});

test("a plan is refused when a path is missing, linked or conflicted", () => {
  assert.equal(discardPlan(["nope.ts"], [], []), null);
  assert.equal(discardPlan(["link"], [], [entry("link", "modified", false)]), null);
  assert.equal(discardPlan([], [], []), null);
});

test("duplicate paths are planned once", () => {
  const plan = discardPlan(["a.ts", "a.ts"], [], [entry("a.ts", "modified")]);
  assert.equal(plan?.files.length, 1);
  assert.equal(plan?.deletes, 0);
});
