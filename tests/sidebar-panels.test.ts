import { test } from "node:test";
import assert from "node:assert/strict";
import { initialSidebarPanel, sidebarPanelReducer, sidebarActivityFeed } from "../src/lib/sidebar-panels.ts";
import { mergeSettings } from "../src/lib/settings.ts";
import type { Project, Session } from "../src/client/types.ts";

test("stale rail leave cannot dismiss a newer hover and pin commits exactly the previewed section", () => {
  const first = sidebarPanelReducer(initialSidebarPanel, { type: "peek", section: "home" });
  const second = sidebarPanelReducer(first, { type: "peek", section: "kanban" });
  assert.equal(sidebarPanelReducer(second, { type: "leave", revision: first.revision }), second);
  const pinned = sidebarPanelReducer(second, { type: "pin" });
  assert.equal(pinned.section, "kanban"); assert.equal(pinned.peek, null);
  assert.equal(sidebarPanelReducer(pinned, { type: "leave", revision: second.revision }), pinned);
  assert.equal(sidebarPanelReducer(second, { type: "leave", revision: second.revision }).peek, null);
});

test("hover previews are temporary while a click selects the section, collapsed or docked", () => {
  const hover = sidebarPanelReducer(initialSidebarPanel, { type: "peek", section: "archived" });
  assert.equal(hover.section, "home"); assert.equal(hover.peek, "archived");
  const peek = sidebarPanelReducer(initialSidebarPanel, { type: "select", section: "archived", collapsed: true });
  assert.equal(peek.section, "archived"); assert.equal(peek.peek, "archived");
  const dismiss = sidebarPanelReducer(peek, { type: "dismiss" });
  assert.equal(dismiss.section, "archived"); assert.equal(dismiss.peek, null);
  const docked = sidebarPanelReducer(dismiss, { type: "select", section: "kanban", collapsed: false });
  assert.equal(docked.section, "kanban"); assert.equal(docked.peek, null);
});

const projects: Project[] = ["a", "b"].map(id => ({ id, name: `Project ${id}`, path: `/fixture/${id}`, addedAt: "time", lastOpenedAt: "time" }));
const session = (id: string, projectId = "a"): Session => ({ id, projectId, title: id, agent: "codex", status: "running", createdAt: "time", lastActivityAt: "time", worktree: { path: "/fixture", branch: `branch/${id}`, isolated: true }, messages: [], lastError: null });
test("activity feed owns every row once, preserves pin order and excludes archived/foreign drafts", () => {
  const sessions = [session("pin", "b"), session("draft"), session("recent"), session("archived"), session("foreign", "missing"), session("blank")];
  const settings = mergeSettings({ pinnedSessionIds: ["pin"], archivedSessionIds: ["archived"] });
  const drafts = { "session:pin": "pinned draft", "session:draft": "draft", "session:archived": "archived", "session:foreign": "foreign", "session:blank": " \n ", "project:a": "project" };
  const sections = sidebarActivityFeed(projects, sessions, settings, drafts);
  assert.deepEqual(sections.map(group => group.sessions.map(row => row.id)), [["pin"], ["draft"], ["recent", "blank"]]);
  assert.equal(new Set(sections.flatMap(group => group.sessions.map(row => row.id))).size, 4);
  assert.deepEqual(sidebarActivityFeed(projects, sessions, settings, drafts, { draftsOnly: true }).flatMap(group => group.sessions.map(row => row.id)), ["pin", "draft"]);
  assert.deepEqual(sidebarActivityFeed(projects, sessions, settings, drafts, { query: "branch/draft", projectId: "a" }).flatMap(group => group.sessions.map(row => row.id)), ["draft"]);
  assert.deepEqual(sidebarActivityFeed(projects, sessions, settings, drafts, { archived: true }).flatMap(group => group.sessions.map(row => row.id)), ["archived"]);
});

test("sidebar PR chips only use an owned cached snapshot matching actual workspace and branch", async () => {
  const { sidebarPullRequest } = await import("../src/lib/sidebar-panels.ts");
  const owner = session("pr");
  const pr = { number: 42, title: "Example", state: "open" as const, draft: false, url: "https://github.com/fixture/repo/pull/42", headBranch: owner.worktree.branch, baseBranch: "main", headSha: "sha", localCommitDiffers: false, checks: [], checksComplete: false, checksTruncated: false };
  const cache = { workspacePath: owner.worktree.path, loading: false, error: null, snapshot: { sessionId: owner.id, repository: "fixture/repo", branch: owner.worktree.branch, localHead: "sha", status: "ready" as const, checkedAt: "time", pullRequest: pr } };
  assert.equal(sidebarPullRequest(owner, cache), pr);
  assert.equal(sidebarPullRequest(owner, { ...cache, workspacePath: "/foreign" }), null);
  assert.equal(sidebarPullRequest(owner, { ...cache, snapshot: { ...cache.snapshot, sessionId: "foreign" } }), null);
  assert.equal(sidebarPullRequest(owner, cache, "changed/branch"), null);
  assert.equal(sidebarPullRequest(owner, cache, null), null);
  assert.equal(sidebarPullRequest(owner, { ...cache, loading: true }), null);
});

test("the Activity view puts each session once: pinned, needs you, working, drafts, then by day, then Done", async () => {
  const { sidebarTimeline } = await import("../src/lib/sidebar-panels.ts");
  const now = new Date(2026, 9, 4, 15, 0);
  const at = (days: number) => new Date(2026, 9, 4 - days, 10, 0).toISOString();
  const row = (id: string, projectId: string, status: Session["status"], days: number): Session => ({ id, projectId, title: id, agent: "codex", status, createdAt: at(days), lastActivityAt: at(days), worktree: { path: "/fixture", branch: "main", isolated: false }, messages: [], lastError: null });
  const rows = [row("pin", "a", "completed", 3), row("wait", "a", "waiting", 5), row("run", "b", "running", 0), row("draft", "b", "completed", 9), row("today", "a", "completed", 0), row("yesterday", "b", "completed", 1), row("old", "a", "completed", 8)];
  const settings = { ...mergeSettings({}), pinnedSessionIds: ["pin"] };
  const sections = sidebarTimeline(projects, rows, settings, { "session:draft": "x", "session:run": "y" }, now);
  assert.deepEqual(sections.map(section => [section.key, section.sessions.map(item => item.id)]), [
    ["pinned", ["pin"]], ["waiting", ["wait"]], ["running", ["run"]], ["drafts", ["draft"]], ["today", ["today"]], ["yesterday", ["yesterday"]], ["earlier", ["old"]],
  ]);
  const scoped = sidebarTimeline(projects, rows, settings, {}, now, { scope: "a" });
  assert.deepEqual(scoped.map(section => section.key), ["pinned", "waiting", "today", "earlier"]);
  // Done moves a session to the end until it has newer activity than the mark.
  const marked = { ...settings, doneSessions: [{ id: "today", at: new Date(2026, 9, 4, 12, 0).toISOString() }, { id: "yesterday", at: new Date(2026, 9, 1).toISOString() }] };
  const withDone = sidebarTimeline(projects, rows, marked, {}, now);
  assert.deepEqual(withDone.at(-1)!.key, "done");
  assert.deepEqual(withDone.at(-1)!.sessions.map(item => item.id), ["today"]);
  assert.ok(withDone.find(section => section.key === "yesterday")!.sessions.some(item => item.id === "yesterday"), "activity after the mark reopens it");
});
