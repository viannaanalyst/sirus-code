import assert from "node:assert/strict";
import { test } from "node:test";
import { withPromptContext, workspaceContext } from "../src/lib/prompt-context.ts";
import type { Session } from "../src/client/types.ts";

test("context is opt-in and preserves the user's exact prompt", () => {
  assert.equal(withPromptContext("Fix this\n", []), "Fix this\n");
  const result = withPromptContext("Fix this\n", [{ label: "Workspace", content: "branch: task" }]);
  assert.ok(result.startsWith("Fix this\n\n\nUser-selected"));
  assert.ok(result.includes("branch: task"));
});

test("context is UTF-8 bounded without broken Unicode and identifies omissions", () => {
  const result = withPromptContext("Prompt", [{ label: "selected diff", content: "🧭".repeat(20000) }]);
  assert.ok(new TextEncoder().encode(result).length < 13 * 1024);
  assert.ok(result.includes("[context truncated]"));
  assert.ok(!result.includes("�"));
});

test("a draft requests isolation without naming an uncreated workspace or branch", () => {
  const snapshot = workspaceContext("/checkout", null, true);
  const data = JSON.parse(snapshot.content);
  assert.equal(data.project, "/checkout");
  assert.equal(data.requestedIsolation, true);
  assert.equal(data.workspace, undefined);
  assert.equal(data.branch, undefined);
});

test("existing Session context identifies its actual isolated destination", () => {
  const session = { worktree: { path: "/owned/worktree", branch: "switchyard/task", isolated: true } } as Session;
  const data = JSON.parse(workspaceContext("/checkout", session, false).content);
  assert.equal(data.workspace, "/owned/worktree");
  assert.equal(data.branch, "switchyard/task");
  assert.equal(data.isolated, true);
});
