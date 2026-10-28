import { test } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "../src/client/types.ts";
import {
  applyRowSettingsAction,
  rowActionRoute,
  summarize,
  summaryWithSettings,
  summaryWithoutSession,
  unreachableRowMenu,
} from "../src/lib/environments.ts";
import { rowMenuItems } from "../src/lib/phone-home.ts";
import { defaultSettings } from "../src/lib/settings.ts";

function session(id: string, fields: Partial<Session> = {}): Session {
  return {
    id, title: `Session ${id}`, projectId: "p1", agent: "codex", status: "idle", createdAt: "2026-10-07T10:00:00Z",
    lastActivityAt: "2026-10-07T10:00:00Z", worktree: { path: "/w", branch: "main", isolated: false }, messages: [], lastError: null, ...fields,
  };
}

test("row actions run on the store for the active computer and through the other computer's client otherwise", () => {
  assert.deepEqual(rowActionRoute(undefined, "home", undefined), { kind: "store" });
  assert.deepEqual(rowActionRoute("home", "home", "lost"), { kind: "store" });
  assert.deepEqual(rowActionRoute("host:vps", "home", "open"), { kind: "remote", environmentId: "host:vps" });
  assert.deepEqual(rowActionRoute("host:vps", "home", "lost"), { kind: "unreachable", environmentId: "host:vps", connecting: false });
  assert.deepEqual(rowActionRoute("host:vps", "home", "unauthorized"), { kind: "unreachable", environmentId: "host:vps", connecting: false });
  assert.deepEqual(rowActionRoute("host:vps", "home", "connecting"), { kind: "unreachable", environmentId: "host:vps", connecting: true });
  assert.deepEqual(rowActionRoute("host:vps", "home", undefined), { kind: "unreachable", environmentId: "host:vps", connecting: true });
  // After a switch the formerly active computer is just another one.
  assert.deepEqual(rowActionRoute("home", "host:vps", "open"), { kind: "remote", environmentId: "home" });
});

test("an unreachable computer's row menu only copies the id and arranges the phone's list", () => {
  const items = rowMenuItems({ place: "home", pinned: false, active: false, order: "updated_at" });
  const menu = unreachableRowMenu(items);
  assert.deepEqual(menu.map((item) => item.id), items.map((item) => item.id));
  assert.deepEqual(menu.filter((item) => !item.disabled).map((item) => item.id), ["copy-id", "arrange"]);
  // The submenus stay as they were (disabled items cannot open them).
  assert.deepEqual(menu.find((item) => item.id === "arrange")?.submenu, items.find((item) => item.id === "arrange")?.submenu);
});

test("pin and unpin change the settings of the row's own computer", () => {
  const theirs = { ...defaultSettings, pinnedSessionIds: ["s1", "s2"] };
  assert.deepEqual(applyRowSettingsAction(theirs, "pin", "s3").pinnedSessionIds, ["s3", "s1", "s2"]);
  assert.equal(applyRowSettingsAction(theirs, "pin", "s1"), theirs, "pinning twice does not unpin");
  assert.deepEqual(applyRowSettingsAction(theirs, "unpin", "s1").pinnedSessionIds, ["s2"]);
  assert.deepEqual(theirs.pinnedSessionIds, ["s1", "s2"], "the input is not changed");
});

test("a computer's summary follows its saved settings and deletions", () => {
  const summary = summarize({ sessions: [session("s1"), session("s2")], projects: [], pinnedSessionIds: ["s2"] }, 1);
  const saved = summaryWithSettings(summary, { pinnedSessionIds: ["s1"] }, 2);
  assert.deepEqual([saved.pinnedSessionIds, saved.updatedAt], [["s1"], 2]);
  const removed = summaryWithoutSession(summary, "s2", 3);
  assert.deepEqual(removed.sessions.map((item) => item.id), ["s1"]);
  assert.deepEqual([removed.pinnedSessionIds, removed.updatedAt], [[], 3]);
});
