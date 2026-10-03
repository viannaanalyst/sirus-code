// Real component renders with disposable native-data fixtures; no IPC or browser.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { EnvironmentPanel } = await server.ssrLoadModule("/src/components/EnvironmentPanel.tsx");
  const { EnvironmentPullRequestSection, PullRequestDetails } = await server.ssrLoadModule("/src/components/EnvironmentPullRequestSection.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const { mergeSettings } = await server.ssrLoadModule("/src/lib/settings.ts");
  const project = { id: "p", name: "Fixture", path: "/fixture", addedAt: "time", lastOpenedAt: "time" };
  const session = { id: "s", projectId: "p", agent: "codex", title: "Fixture", status: "idle", createdAt: "time", lastActivityAt: "time", worktree: { path: "/fixture", branch: "main", isolated: false }, messages: [], lastError: null };
  const pr = { number: 7, title: "<script>unsafe title</script>", state: "open", draft: true, url: "https://github.com/owner/repo/pull/7", headBranch: "feature", baseBranch: "main", headSha: "a".repeat(40), localCommitDiffers: true, checksComplete: false, checksTruncated: true,
    checks: [{ id: "run:1", name: "<img src=x onerror=unsafe>", status: "passed", url: "https://github.com/owner/repo/runs/1" }] };
  const snapshot = { sessionId: "s", repository: "owner/repo", branch: "feature", localHead: "b".repeat(40), status: "ready", checkedAt: "2026-10-02T12:30:00Z", pullRequest: pr };
  const initial = useAppStore.getInitialState();
  const fixture = values => { Object.assign(initial, values); useAppStore.setState(values); };
  fixture({ settings: mergeSettings({ locale: "pt-BR" }), projects: [project], sessions: [session], selectedProjectId: "p", selectedSessionId: "s", environmentOpen: true,
    pullRequestsBySession: { s: { workspacePath: "/fixture", loading: false, error: null, snapshot } } });
  const row = renderToString(createElement(EnvironmentPullRequestSection, { session }));
  assert.ok(row.includes("Atualizar pull request"));
  assert.ok(row.includes("Checks incompletos"));
  assert.ok(row.includes("&lt;script&gt;unsafe title&lt;/script&gt;"));
  assert.doesNotMatch(row, /<script>|role="tooltip"/);
  const details = renderToString(createElement(PullRequestDetails, { pr, checkedAt: snapshot.checkedAt, onOpen: () => {} }));
  assert.ok(details.includes("Abrir PR") && details.includes("Ver checks"));
  assert.ok(details.includes("Checks do commit aaaaaaa"));
  assert.ok(details.includes("O commit local é diferente do commit da PR."));
  assert.ok(details.includes("Exibindo parte dos checks."));
  assert.ok(details.includes("&lt;img src=x onerror=unsafe&gt;"));
  assert.doesNotMatch(details, /<img|<script|role="tooltip"/);
  for (const [status, text] of [["noPullRequest", "Nenhuma pull request"], ["cliMissing", "Instale o GitHub CLI"], ["authRequired", "gh auth login"], ["notGit", "não é um repositório Git"]]) {
    fixture({ pullRequestsBySession: { s: { workspacePath: "/fixture", loading: false, error: null, snapshot: { ...snapshot, status, pullRequest: null } } } });
    assert.ok(renderToString(createElement(EnvironmentPullRequestSection, { session })).includes(text), status);
  }
  fixture({ pullRequestsBySession: { s: { workspacePath: "/fixture", loading: true, error: null, snapshot: null } } });
  assert.ok(renderToString(createElement(EnvironmentPullRequestSection, { session })).includes("Carregando pull request…"));
  fixture({ settings: mergeSettings({ showEnvironmentPullRequest: false }) });
  assert.ok(!renderToString(createElement(EnvironmentPanel)).includes("Atualizar pull request"), "hidden card unmounts its probe owner");
  fixture({ settings: mergeSettings({ showEnvironmentPullRequest: true }) });
  assert.ok(renderToString(createElement(EnvironmentPanel)).includes("Atualizar pull request"));
  console.log("PR card states, escaped content, commit identity, visibility and localized actions passed");
} finally { await server.close(); }
