import assert from "node:assert/strict";
import { test } from "node:test";
import { client } from "../src/client/index.ts";
import type { PullRequest, PullRequestSnapshot, Session } from "../src/client/types.ts";
import { checkSummary } from "../src/lib/pull-requests.ts";
import { defaultSettings, mergeSettings, resetGeneralSettings } from "../src/lib/settings.ts";
import { useAppStore } from "../src/store/app-store.ts";

const project = { id: "p", name: "Fixture", path: "/fixture", addedAt: "time", lastOpenedAt: "time" };
const session = (id: string): Session => ({ id, projectId: "p", title: id, agent: "codex", status: "idle", createdAt: "time", lastActivityAt: "time", messages: [], lastError: null,
  worktree: { path: "/fixture", branch: "main", isolated: false } });
const snapshot = (id: string, branch = "main"): PullRequestSnapshot => ({ sessionId: id, repository: "owner/repo", branch, localHead: "a".repeat(40), status: "noPullRequest", checkedAt: new Date().toISOString(), pullRequest: null });
function setup() { useAppStore.setState({ settings: mergeSettings({}), projects: [project], sessions: [session("s"), session("other")], selectedSessionId: "s", selectedProjectId: "p", gitStatus: null, pullRequestsBySession: {} }); }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const pr: PullRequest = { number: 1, title: "Title", state: "open", draft: false, url: "https://github.com/owner/repo/pull/1", headBranch: "feature", baseBranch: "main", headSha: "a".repeat(40), localCommitDiffers: false, checks: [], checksComplete: true, checksTruncated: false };

test("partial, unknown and skipped checks never masquerade as a passing build", () => {
  const passed = { id: "build", name: "build", status: "passed" as const, url: null };
  assert.equal(checkSummary(pr).status, "none");
  assert.equal(checkSummary({ ...pr, checks: [passed] }).status, "passed");
  assert.equal(checkSummary({ ...pr, checks: [passed], checksComplete: false }).status, "unknown");
  assert.equal(checkSummary({ ...pr, checks: [passed], checksTruncated: true }).status, "unknown");
  assert.equal(checkSummary({ ...pr, checks: [{ ...passed, status: "unknown" }] }).status, "unknown");
  assert.equal(checkSummary({ ...pr, checks: [{ ...passed, status: "skipped" }] }).status, "skipped");
  assert.equal(checkSummary({ ...pr, checks: [passed, { ...passed, id: "pending", status: "pending" }] }).status, "pending");
  assert.equal(checkSummary({ ...pr, checks: [{ ...passed, status: "failed" }], checksComplete: false }).status, "failed");
  const off = mergeSettings({ showEnvironmentPullRequest: false });
  assert.equal(resetGeneralSettings(off).showEnvironmentPullRequest, true);
  assert.equal(defaultSettings.showEnvironmentPullRequest, true);
});

test("PR requests are coalesced, cached by owner and refreshed explicitly", async context => {
  setup(); const wait = deferred(); let calls = 0;
  context.mock.method(client, "sessionPullRequest", async (id: string) => { calls++; await wait.promise; return snapshot(id); });
  const first = useAppStore.getState().refreshPullRequest("s");
  const same = useAppStore.getState().refreshPullRequest("s");
  useAppStore.setState({ selectedSessionId: "other" });
  wait.resolve(); await Promise.all([first, same]);
  assert.equal(calls, 1); assert.equal(useAppStore.getState().pullRequestsBySession.s.snapshot?.sessionId, "s");
  assert.equal(useAppStore.getState().pullRequestsBySession.other, undefined);
  await useAppStore.getState().refreshPullRequest("s"); assert.equal(calls, 1);
  await useAppStore.getState().refreshPullRequest("s", true); assert.equal(calls, 2);
});

test("removing an owner prevents late PR snapshots from resurrecting it", async context => {
  setup(); const wait = deferred();
  context.mock.method(client, "sessionPullRequest", async (id: string) => { await wait.promise; return snapshot(id); });
  context.mock.method(client, "removeProject", async () => {});
  const pending = useAppStore.getState().refreshPullRequest("s");
  await useAppStore.getState().removeProject("p"); wait.resolve(); await pending;
  assert.deepEqual(useAppStore.getState().pullRequestsBySession, {});
});

test("a workspace change queues its own probe and discards the old result", async context => {
  setup(); const wait = deferred(); let calls = 0;
  context.mock.method(client, "sessionPullRequest", async (id: string) => { calls++; if (calls === 1) { await wait.promise; return snapshot(id); } return snapshot(id, "new"); });
  const first = useAppStore.getState().refreshPullRequest("s");
  useAppStore.setState({ sessions: [{ ...session("s"), worktree: { path: "/new", branch: "new", isolated: true } }] });
  const second = useAppStore.getState().refreshPullRequest("s", true);
  wait.resolve(); await Promise.all([first, second]);
  const result = useAppStore.getState().pullRequestsBySession.s;
  assert.equal(calls, 2); assert.equal(result.workspacePath, "/new"); assert.equal(result.snapshot?.branch, "new"); assert.equal(result.loading, false);
});

test("foreign acknowledgements are refused and a failed probe can be retried", async context => {
  setup(); let foreign = true;
  context.mock.method(client, "sessionPullRequest", async (id: string) => snapshot(foreign ? "foreign" : id));
  await useAppStore.getState().refreshPullRequest("s");
  assert.equal(useAppStore.getState().pullRequestsBySession.s.snapshot, null);
  assert.ok(useAppStore.getState().pullRequestsBySession.s.error);
  foreign = false; await useAppStore.getState().refreshPullRequest("s", true);
  assert.equal(useAppStore.getState().pullRequestsBySession.s.error, null);
  assert.equal(useAppStore.getState().pullRequestsBySession.s.snapshot?.sessionId, "s");
});
