import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project, Session } from "../src/client/types.ts";
import { mergeSettings } from "../src/lib/settings.ts";
import { archiveSidebarSession, pruneSidebarSettings, sidebarGroups, moveSidebarProject, toggleSidebarId } from "../src/lib/sidebar-layout.ts";

const projects: Project[] = ["a", "b"].map(id => ({ id, name: id, path: `/fixture/${id}`, addedAt: "time", lastOpenedAt: "time" }));
const session = (id: string, projectId = "a"): Session => ({ id, title: id, projectId, agent: "codex", status: "running", createdAt: "time", lastActivityAt: "time", worktree: { path: "/fixture", branch: "main", isolated: false }, messages: [], lastError: null });

test("pins span projects exactly once and archives do not alter native execution", () => {
  const sessions = [session("one"), session("two", "b"), session("three"), session("foreign", "missing")];
  const settings = mergeSettings({ pinnedProjectIds: ["b"], pinnedSessionIds: ["two", "one", "three"], archivedSessionIds: ["three"] });
  const groups = sidebarGroups(projects, sessions, settings);
  assert.deepEqual(groups.projects.map(row => row.id), ["b", "a"]);
  assert.deepEqual(groups.pinned.map(row => row.id), ["two", "one"]);
  assert.deepEqual(groups.nested, []);
  assert.deepEqual(groups.archived.map(row => row.id), ["three"]);
  assert.ok(sessions.every(row => row.status === "running"));
  assert.deepEqual(projects.map(row => row.id), ["a", "b"]);
});

test("unpin returns a session to its own project and archive restore is reversible", () => {
  const sessions = [session("one"), session("two", "b")];
  const settings = mergeSettings({ pinnedSessionIds: ["one"] });
  const unpinned = { ...settings, pinnedSessionIds: toggleSidebarId(settings.pinnedSessionIds, "one") };
  assert.deepEqual(sidebarGroups(projects, sessions, unpinned).nested, sessions);
  const archived = archiveSidebarSession(settings, "one");
  assert.deepEqual(archived.pinnedSessionIds, []);
  assert.deepEqual(sidebarGroups(projects, sessions, archived).archived, [sessions[0]]);
  const restored = archiveSidebarSession(archived, "one");
  assert.deepEqual(sidebarGroups(projects, sessions, restored).nested, sessions);
  assert.deepEqual(settings.pinnedSessionIds, ["one"]);
});

test("removed projects and sessions cannot retain sidebar references", () => {
  const settings = mergeSettings({ pinnedProjectIds: ["a", "b"], pinnedSessionIds: ["one", "missing"], archivedSessionIds: ["two", "missing"] });
  const pruned = pruneSidebarSettings(settings, [projects[1]], [session("two", "b")]);
  assert.deepEqual(pruned.pinnedProjectIds, ["b"]);
  assert.deepEqual(pruned.pinnedSessionIds, []);
  assert.deepEqual(pruned.archivedSessionIds, ["two"]);
  assert.deepEqual(mergeSettings({}).pinnedSessionIds, []);
});


test("manual folder order survives project selection, supports both drop edges and keeps pins first", () => {
  const rows = [...projects, { ...projects[0], id: "c", name: "c" }];
  const settings = mergeSettings({});
  const below = moveSidebarProject(rows, settings, "a", "c", "after");
  assert.deepEqual(sidebarGroups(rows, [], below).projects.map(row => row.id), ["b", "c", "a"]);
  assert.deepEqual(sidebarGroups([...rows].reverse(), [], below).projects.map(row => row.id), ["b", "c", "a"]);
  const above = moveSidebarProject(rows, below, "a", "b", "before");
  assert.deepEqual(above.sidebarProjectOrder, ["a", "b", "c"]);
  const pinned = { ...below, pinnedProjectIds: ["a"] };
  assert.deepEqual(sidebarGroups(rows, [], pinned).projects.map(row => row.id), ["a", "b", "c"]);
  assert.strictEqual(moveSidebarProject(rows, pinned, "b", "a", "before"), pinned);
  assert.strictEqual(moveSidebarProject(rows, below, "missing", "b", "before"), below);
  assert.deepEqual(pruneSidebarSettings(below, [rows[0]], []).sidebarProjectOrder, ["a"]);
  assert.deepEqual(mergeSettings({}).sidebarProjectOrder, []);
  assert.deepEqual(rows.map(row => row.id), ["a", "b", "c"]);
});

test("automatic sidebar ordering uses real timestamps, keeps pins first and leaves input untouched", () => {
  const rows = [
    { ...projects[0], addedAt: "2026-01-01", lastOpenedAt: "2026-01-05" },
    { ...projects[1], addedAt: "2026-01-03", lastOpenedAt: "2026-01-04" },
    { ...projects[0], id: "c", addedAt: "2026-01-02", lastOpenedAt: "2026-01-02" },
  ];
  const sessions = [
    { ...session("old", "a"), createdAt: "2026-01-01", lastActivityAt: "2026-01-07" },
    { ...session("new", "a"), createdAt: "2026-01-03", lastActivityAt: "2026-01-03" },
    { ...session("middle", "c"), createdAt: "2026-01-02", lastActivityAt: "2026-01-08" },
  ];
  const before = JSON.stringify({ rows, sessions });
  const created = sidebarGroups(rows, sessions, mergeSettings({ sidebarProjectSortOrder: "created_at", sidebarThreadSortOrder: "created_at" }));
  assert.deepEqual(created.projects.map(row => row.id), ["b", "c", "a"]);
  assert.deepEqual(created.nested.filter(row => row.projectId === "a").map(row => row.id), ["new", "old"]);
  const recent = sidebarGroups(rows, sessions, mergeSettings({ sidebarProjectSortOrder: "manual", sidebarThreadSortOrder: "updated_at", pinnedProjectIds: ["c"], pinnedSessionIds: ["old", "middle"] }));
  assert.deepEqual(recent.projects.map(row => row.id), ["c", "a", "b"], "activity never reorders folders");
  assert.deepEqual(recent.pinned.map(row => row.id), ["old", "middle"]);
  assert.deepEqual(recent.nested.map(row => row.id), ["new"]);
  const unpinned = sidebarGroups(rows, sessions, mergeSettings({ sidebarThreadSortOrder: "updated_at" }));
  assert.deepEqual(unpinned.nested.filter(row => row.projectId === "a").map(row => row.id), ["old", "new"]);
  assert.equal(JSON.stringify({ rows, sessions }), before);
});

test("dragging from an automatic order returns to manual mode and timestamp ties stay stable", () => {
  const rows = [{ ...projects[0], addedAt: "2026-01-01" }, { ...projects[1], addedAt: "2026-01-02" }];
  const automatic = mergeSettings({ sidebarProjectSortOrder: "created_at" });
  const moved = moveSidebarProject(rows, automatic, "a", "b", "before");
  assert.equal(moved.sidebarProjectSortOrder, "manual");
  assert.deepEqual(sidebarGroups(rows, [], moved).projects.map(row => row.id), ["a", "b"]);
  assert.deepEqual(sidebarGroups(projects, [session("one"), session("two")], automatic).nested.map(row => row.id), ["one", "two"]);
});

test("manual drag preserves the displayed created order of folders that were not moved", () => {
  const rows = [...projects, { ...projects[0], id: "c" }, { ...projects[0], id: "d" }].map((row, index) => ({ ...row, addedAt: `2026-01-0${4 - index}` }));
  const settings = mergeSettings({ sidebarProjectSortOrder: "created_at" });
  assert.deepEqual(sidebarGroups(rows, [], settings).projects.map(row => row.id), ["a", "b", "c", "d"]);
  const moved = moveSidebarProject(rows, settings, "d", "b", "before");
  assert.equal(moved.sidebarProjectSortOrder, "manual");
  assert.deepEqual(sidebarGroups(rows, [], moved).projects.map(row => row.id), ["a", "d", "b", "c"]);
});

test("retired Recent activity project order loads as manual", () => {
  assert.equal(mergeSettings({ sidebarProjectSortOrder: "updated_at" as never }).sidebarProjectSortOrder, "manual");
});
