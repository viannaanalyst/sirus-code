import { test } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "../src/client/types.ts";
import {
  PENDING_ACTIONS_KEY,
  PENDING_LIMIT,
  filterByEnvironment,
  flushPendingActions,
  pendingSessions,
  queueRowAction,
  readPendingActions,
  summaryWithPending,
  unreachableEnvironments,
  writePendingActions,
  type Environment,
  type EnvironmentSummary,
  type PendingRowAction,
} from "../src/lib/environments.ts";

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const session = (id: string, fields: Partial<Session> = {}) => ({
  id, title: `Session ${id}`, projectId: "p1", agent: "codex", status: "idle", createdAt: "2026-10-07T10:00:00Z",
  lastActivityAt: "2026-10-07T10:00:00Z", worktree: { path: "/w", branch: "main", isolated: false }, messages: [], ...fields,
}) as Session;

test("actions for an unreachable computer wait, the latest of each kind wins", () => {
  let queue: PendingRowAction[] = [];
  queue = queueRowAction(queue, { environmentId: "vps", sessionId: "a", action: { type: "pin" } }, 1);
  queue = queueRowAction(queue, { environmentId: "vps", sessionId: "a", action: { type: "snooze", until: null } }, 2);
  queue = queueRowAction(queue, { environmentId: "vps", sessionId: "a", action: { type: "unpin" } }, 3);
  queue = queueRowAction(queue, { environmentId: "mac", sessionId: "a", action: { type: "pin" } }, 4);
  queue = queueRowAction(queue, { environmentId: "vps", sessionId: "b", action: { type: "rename", title: "One" } }, 5);
  queue = queueRowAction(queue, { environmentId: "vps", sessionId: "b", action: { type: "rename", title: "Two" } }, 6);
  assert.deepEqual(queue.map((item) => [item.environmentId, item.sessionId, item.action.type]), [
    ["vps", "a", "snooze"], ["vps", "a", "unpin"], ["mac", "a", "pin"], ["vps", "b", "rename"],
  ]);
  assert.equal((queue[3].action as { title: string }).title, "Two");
  // A delete replaces whatever waited for that conversation.
  queue = queueRowAction(queue, { environmentId: "vps", sessionId: "a", action: { type: "delete", removeWorktree: false } }, 7);
  assert.deepEqual(queue.map((item) => [item.environmentId, item.sessionId, item.action.type]), [
    ["mac", "a", "pin"], ["vps", "b", "rename"], ["vps", "a", "delete"],
  ]);
  assert.deepEqual([...pendingSessions(queue, "vps")].sort(), ["a", "b"]);
  // The queue is bounded.
  let many: PendingRowAction[] = [];
  for (let index = 0; index < PENDING_LIMIT + 10; index += 1) many = queueRowAction(many, { environmentId: "vps", sessionId: `s${index}`, action: { type: "pin" } }, index);
  assert.equal(many.length, PENDING_LIMIT);
  assert.equal(many[0].sessionId, "s10");
});

test("waiting actions survive in storage and bad entries are dropped", () => {
  const storage = memory();
  const queue = queueRowAction([], { environmentId: "vps", sessionId: "a", action: { type: "snooze", until: "2026-10-20T09:00:00Z" } }, 1);
  writePendingActions(storage, queue);
  assert.deepEqual(readPendingActions(storage), queue);
  storage.setItem(PENDING_ACTIONS_KEY, JSON.stringify([...queue, { id: "x", environmentId: "vps", sessionId: "b", createdAt: 1, action: { type: "explode" } }, { id: "y", environmentId: "vps", sessionId: "c", createdAt: 1, action: { type: "rename", title: " " } }]));
  assert.deepEqual(readPendingActions(storage), queue);
  storage.setItem(PENDING_ACTIONS_KEY, "{");
  assert.deepEqual(readPendingActions(storage), []);
});

test("rows already show what waits", () => {
  const summary: EnvironmentSummary = { sessions: [session("a"), session("b"), session("c")], projects: [], pinnedSessionIds: ["c"], updatedAt: 5 };
  let queue: PendingRowAction[] = [];
  queue = queueRowAction(queue, { environmentId: "vps", sessionId: "a", action: { type: "pin" } }, 1);
  queue = queueRowAction(queue, { environmentId: "vps", sessionId: "b", action: { type: "pin" } }, 2);
  queue = queueRowAction(queue, { environmentId: "vps", sessionId: "b", action: { type: "snooze", until: "2026-10-20T09:00:00Z" } }, 3);
  queue = queueRowAction(queue, { environmentId: "vps", sessionId: "b", action: { type: "rename", title: " Renamed " } }, 4);
  queue = queueRowAction(queue, { environmentId: "vps", sessionId: "c", action: { type: "unpin" } }, 5);
  const shown = summaryWithPending(summary, queue);
  assert.deepEqual(shown.pinnedSessionIds, ["b", "a"]);
  const b = shown.sessions.find((item) => item.id === "b")!;
  assert.equal(b.snoozedUntil, "2026-10-20T09:00:00Z");
  assert.equal(b.title, "Renamed");
  const deleted = summaryWithPending(summary, queueRowAction([], { environmentId: "vps", sessionId: "a", action: { type: "delete", removeWorktree: true } }, 1));
  assert.deepEqual(deleted.sessions.map((item) => item.id), ["b", "c"]);
  assert.equal(summaryWithPending(summary, []), summary);
});

test("a computer's actions go out in order when it is back; a failure keeps the rest", async () => {
  let queue: PendingRowAction[] = [];
  queue = queueRowAction(queue, { environmentId: "vps", sessionId: "a", action: { type: "pin" } }, 1);
  queue = queueRowAction(queue, { environmentId: "mac", sessionId: "m", action: { type: "pin" } }, 2);
  queue = queueRowAction(queue, { environmentId: "vps", sessionId: "b", action: { type: "pin" } }, 3);
  queue = queueRowAction(queue, { environmentId: "vps", sessionId: "c", action: { type: "pin" } }, 4);
  const sent: string[] = [];
  const left = await flushPendingActions(queue, "vps", async (item) => { sent.push(item.sessionId); return item.sessionId !== "b"; });
  assert.deepEqual(sent, ["a", "b"]);
  assert.deepEqual(left.map((item) => item.sessionId), ["m", "b", "c"]);
  const thrown = await flushPendingActions(left, "vps", async () => { throw new Error("lost"); });
  assert.equal(thrown.length, 3);
  assert.deepEqual((await flushPendingActions(left, "vps", async () => true)).map((item) => item.sessionId), ["m"]);
});

test("Home names the computers it is reconnecting to; filters pick a computer's rows", () => {
  const environments: Environment[] = [
    { id: "home", label: "", kind: "mac", baseUrl: "https://mac.t.ts.net", token: "t", hostName: "" },
    { id: "vps", label: "", kind: "server", baseUrl: "https://vps.t.ts.net", token: "t", hostName: "vps" },
    { id: "old", label: "", kind: "server", baseUrl: "https://old.t.ts.net", token: "", hostName: "old" },
  ];
  assert.deepEqual(unreachableEnvironments(environments, { home: "open", vps: "lost", old: "lost" }).map((item) => [item.environment.id, item.connecting]), [["vps", false]]);
  assert.deepEqual(unreachableEnvironments(environments, { home: "connecting", vps: "open" }).map((item) => [item.environment.id, item.connecting]), [["home", true]]);
  assert.deepEqual(unreachableEnvironments(environments, { home: "idle" }), []);
  const rows = [session("a"), session("b"), session("c")];
  const environmentOf = new Map([["a", "home"], ["b", "vps"]]);
  assert.deepEqual(filterByEnvironment(rows, environmentOf, "all", "home").map((item) => item.id), ["a", "b", "c"]);
  assert.deepEqual(filterByEnvironment(rows, environmentOf, "vps", "home").map((item) => item.id), ["b"]);
  // A row not in the map is the active computer's.
  assert.deepEqual(filterByEnvironment(rows, environmentOf, "home", "home").map((item) => item.id), ["a", "c"]);
});
