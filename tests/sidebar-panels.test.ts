import { test } from "node:test";
import assert from "node:assert/strict";
import { sidebarActivityFeed } from "../src/lib/sidebar-panels.ts";
import { mergeSettings } from "../src/lib/settings.ts";
import type { Project, Session } from "../src/client/types.ts";

const projects: Project[] = ["a", "b"].map(id => ({ id, name: `Project ${id}`, path: `/fixture/${id}`, addedAt: "time", lastOpenedAt: "time" }));
const session = (id: string, projectId = "a"): Session => ({ id, projectId, title: id, agent: "codex", status: "running", createdAt: "time", lastActivityAt: "time", worktree: { path: "/fixture", branch: `branch/${id}`, isolated: true }, messages: [], lastError: null });
test("activity feed owns every row once, preserves pin order and excludes foreign sessions", () => {
  const sessions = [session("pin", "b"), session("draft"), session("recent"), session("foreign", "missing"), session("blank")];
  const settings = mergeSettings({ pinnedSessionIds: ["pin"] });
  const sections = sidebarActivityFeed(projects, sessions, settings);
  assert.deepEqual(sections.map(group => group.sessions.map(row => row.id)), [["pin"], ["draft", "recent", "blank"]]);
  assert.equal(new Set(sections.flatMap(group => group.sessions.map(row => row.id))).size, 4);
  assert.deepEqual(sidebarActivityFeed(projects, sessions, settings, { query: "branch/draft", projectId: "a" }).flatMap(group => group.sessions.map(row => row.id)), ["draft"]);
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
