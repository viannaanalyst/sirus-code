import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session, SessionStatus } from "../src/client/types.ts";
import { groupProjectSessions } from "../src/lib/session-board.ts";

const fixture = (id: string, status: SessionStatus, projectId = "owned", lastActivityAt = "2026-10-01T10:00:00Z"): Session => ({
  id, projectId, title: id, agent: "codex", status, createdAt: lastActivityAt, lastActivityAt,
  worktree: { path: "/fixture", branch: "main", isolated: false }, messages: [], lastError: null,
});

test("session board projects every native lifecycle state exactly once", () => {
  const sessions = (["idle", "starting", "running", "waiting", "completed", "failed", "stopped"] as const).map((state) => fixture(state, state));
  const groups = groupProjectSessions(sessions, "owned");
  assert.deepEqual(groups.queued.map((s) => s.id), ["idle"]);
  assert.deepEqual(groups.active.map((s) => s.id), ["starting", "running"]);
  assert.deepEqual(groups.waiting.map((s) => s.id), ["waiting"]);
  assert.deepEqual(groups.completed.map((s) => s.id), ["completed"]);
  assert.deepEqual(groups.interrupted.map((s) => s.id), ["failed", "stopped"]);
  assert.equal(Object.values(groups).flat().length, sessions.length);
  assert.ok(sessions.every((session) => session.status === session.id));
});

test("session board isolates projects and sorts without mutating the session list", () => {
  const older = fixture("older", "completed");
  const newer = fixture("newer", "completed", "owned", "2026-10-01T11:00:00Z");
  const other = fixture("other", "completed", "foreign");
  const sessions = Object.freeze([older, other, newer]);
  assert.deepEqual(groupProjectSessions(sessions, "owned").completed, [newer, older]);
  assert.deepEqual(sessions, [older, other, newer]);
  assert.ok(Object.values(groupProjectSessions(sessions, null)).every((column) => column.length === 0));
});
