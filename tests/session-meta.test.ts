import { test } from "node:test";
import assert from "node:assert/strict";
import { sameSessionMeta, selectCurrentSessionMeta, selectSessionsMeta, useAppStore } from "../src/store/app-store.ts";
import type { Session } from "../src/client/types.ts";

const session = (id: string, title = "Title"): Session => ({ id, projectId: "p", title, agent: "codex", status: "running", createdAt: "t", lastActivityAt: "t", worktree: { path: "/fixture", branch: "main", isolated: false }, messages: [], lastError: null });

test("streamed text alone keeps metadata selections stable; any other field updates them", () => {
  const first = session("a");
  assert.ok(sameSessionMeta(first, { ...first, messages: [{ id: "m", sessionId: "a", role: "agent", content: "x", createdAt: "t", streaming: true }] }));
  assert.ok(!sameSessionMeta(first, { ...first, status: "completed" }));

  const state = { ...useAppStore.getState(), sessions: [first, session("b")], selectedSessionId: "a" };
  const list = selectSessionsMeta(state);
  const current = selectCurrentSessionMeta(state);
  const streamed = { ...state, sessions: [{ ...first, messages: [] }, state.sessions[1]] };
  assert.equal(selectSessionsMeta(streamed), list);
  assert.equal(selectCurrentSessionMeta(streamed), current);

  const renamed = { ...state, sessions: [session("a", "Renamed"), state.sessions[1]] };
  assert.equal(selectSessionsMeta(renamed)[0].title, "Renamed");
  assert.equal(selectCurrentSessionMeta(renamed)?.title, "Renamed");
  assert.equal(selectSessionsMeta({ ...state, sessions: [first] }).length, 1);
});
