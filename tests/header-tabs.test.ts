import { test } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "../src/client/types.ts";
import { closeTab, finishedUnseen, moveTab, openTab, projectStatus, tabStatus, TAB_LIMIT, visibleTabSessions } from "../src/lib/header-tabs.ts";

const session = (id: string, projectId = "p", status: Session["status"] = "idle"): Session => ({ id, title: id, projectId, agent: "codex", status, createdAt: "t", lastActivityAt: "t", worktree: { path: "/f", branch: "main", isolated: false }, messages: [], lastError: null } as Session);

test("opening keeps order, never duplicates and drops the oldest inactive tab past the limit", () => {
  assert.deepEqual(openTab(["a"], "b"), ["a", "b"]);
  assert.deepEqual(openTab(["a", "b"], "a"), ["a", "b"]);
  const full = Array.from({ length: TAB_LIMIT }, (_, index) => `s${index}`);
  const next = openTab(full, "new");
  assert.equal(next.length, TAB_LIMIT);
  assert.equal(next.includes("s0"), false);
  assert.equal(next.at(-1), "new");
});

test("closing a tab selects its right neighbour, else the left one, and never touches sessions", () => {
  assert.deepEqual(closeTab(["a", "b", "c"], "b"), { tabs: ["a", "c"], neighbor: "c", index: 1 });
  assert.deepEqual(closeTab(["a", "b", "c"], "c"), { tabs: ["a", "b"], neighbor: "b", index: 2 });
  assert.deepEqual(closeTab(["a"], "a"), { tabs: [], neighbor: null, index: 0 });
  assert.equal(closeTab(["a"], "x").index, -1);
});

test("reordering moves the dragged tab onto the target position", () => {
  assert.deepEqual(moveTab(["a", "b", "c"], "c", "a"), ["c", "a", "b"]);
  assert.deepEqual(moveTab(["a", "b", "c"], "a", "c"), ["b", "c", "a"]);
  assert.deepEqual(moveTab(["a", "b", "c"], "a", "c", "before"), ["b", "a", "c"]);
  assert.deepEqual(moveTab(["a", "b", "c"], "c", "a", "after"), ["a", "c", "b"]);
});

test("only owned, unarchived sessions of the current project are shown", () => {
  const sessions = [session("a"), session("b", "other"), session("c")];
  assert.deepEqual(visibleTabSessions(["a", "b", "c", "gone"], sessions, "p", ["c"]).map((row) => row.id), ["a"]);
});

test("tab and project status: waiting beats running beats unseen completion", () => {
  const unseen = new Set(["done"]);
  assert.equal(tabStatus(session("w", "p", "waiting"), unseen), "waiting");
  assert.equal(tabStatus(session("r", "p", "running"), unseen), "running");
  assert.equal(tabStatus(session("done", "p", "completed"), unseen), "done");
  assert.equal(tabStatus(session("x", "p", "completed"), unseen), "idle");
  assert.equal(tabStatus(session("c", "p", "idle"), unseen, new Set(["c"])), "waiting", "computer approvals count as waiting");
  const sessions = [session("r", "p", "running"), session("w", "p", "waiting"), session("done", "q", "completed")];
  assert.equal(projectStatus("p", sessions, unseen), "waiting");
  assert.equal(projectStatus("q", sessions, unseen), "done");
  assert.equal(projectStatus("empty", sessions, unseen), "idle");
});

test("a session finishing out of view becomes unseen; the selected one does not", () => {
  const previous = new Map<string, Session["status"]>([["a", "running"], ["b", "running"], ["c", "idle"]]);
  const now = [session("a", "p", "completed"), session("b", "p", "completed"), session("c", "p", "completed")];
  assert.deepEqual(finishedUnseen(previous, now, "b"), ["a"]);
});
