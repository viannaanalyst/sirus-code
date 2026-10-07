import { test } from "node:test";
import assert from "node:assert/strict";
import { groupTasks, overdue, sortTasks, taskStatus } from "../src/lib/tasks.ts";
import { inboxGroups, needsYouCount } from "../src/lib/inbox.ts";
import type { Session, Task } from "../src/client/types.ts";

const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, notes: "", priority: "none", projectId: null, dueDate: null, sessionId: null, completedAt: null, createdAt: "t", updatedAt: "t", ...extra });
const session = (id: string, status: Session["status"], extra: Partial<Session> = {}): Session => ({ id, projectId: "p", title: id, agent: "codex", status, createdAt: "t", lastActivityAt: "t", worktree: { path: "/fixture", branch: "main", isolated: false }, messages: [], lastError: null, ...extra });

test("task status follows its linked session; done wins", () => {
  const sessions = [session("w", "waiting"), session("r", "running"), session("c", "completed"), session("f", "failed")];
  assert.equal(taskStatus(task("a"), sessions), "todo");
  assert.equal(taskStatus(task("a", { sessionId: "w" }), sessions), "needs");
  assert.equal(taskStatus(task("a", { sessionId: "r" }), sessions), "running");
  assert.equal(taskStatus(task("a", { sessionId: "c" }), sessions), "review");
  assert.equal(taskStatus(task("a", { sessionId: "f" }), sessions), "stopped");
  assert.equal(taskStatus(task("a", { sessionId: "gone" }), sessions), "todo");
  assert.equal(taskStatus(task("a", { sessionId: "r", completedAt: "t" }), sessions), "done");
  assert.deepEqual(groupTasks([task("x", { sessionId: "w" }), task("y")], sessions).map((section) => section.key), ["tasks.section.needs", "tasks.section.todo"]);
});

test("tasks sort by priority, due date and age; overdue uses local today", () => {
  const sorted = sortTasks([task("low", { priority: "low" }), task("late", { priority: "high", dueDate: "2026-12-01" }), task("soon", { priority: "high", dueDate: "2026-10-06" }), task("urgent", { priority: "urgent" })]);
  assert.deepEqual(sorted.map((item) => item.id), ["urgent", "soon", "late", "low"]);
  assert.equal(overdue(task("a", { dueDate: "2026-10-01" }), new Date(2026, 9, 5)), true);
  assert.equal(overdue(task("a", { dueDate: "2026-10-05" }), new Date(2026, 9, 5)), false);
});

test("the inbox groups sessions by what they need and skips side chats and archives", () => {
  const sessions = [session("w", "waiting"), session("side", "waiting", { sideChat: { parentSessionId: "w" } }), session("r", "running"), session("c", "completed"), session("seen", "completed"), session("f", "failed"), session("arch", "waiting")];
  const groups = inboxGroups(sessions, ["c", "f"], ["arch"], { viewer: "me", repositories: [], items: [{ kind: "pullRequest", repository: "a/b", number: 1, title: "t", url: "u", state: "open", isDraft: false, author: "x", createdAt: "t", updatedAt: "t", headRef: null, baseRef: null, additions: 0, deletions: 0, reviewDecision: null, mergeable: null, labels: [], commentCount: 0, assignees: [], reviewRequests: ["me"], checks: null }], failures: [], checkedAt: "t" }, [{ id: "h", astroId: "a", lastError: "x" } as never, { id: "old", astroId: null, lastError: "y" } as never]);
  assert.deepEqual(groups.needsYou.map((item) => item.id), ["w"]);
  assert.deepEqual(groups.running.map((item) => item.id), ["r"]);
  assert.deepEqual(groups.review.map((item) => item.id), ["c"]);
  assert.deepEqual(groups.failed.map((item) => item.id), ["f"]);
  assert.equal(groups.reviewRequests, 1);
  assert.deepEqual(groups.habitIssues.map((item) => item.id), ["h"], "retired standalone automations stay out of the inbox");
  assert.equal(needsYouCount(groups), 3);
});
