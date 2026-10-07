import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { TurnChangeSummary } = await server.ssrLoadModule("/src/components/TurnChangeSummary.tsx");
  const { TurnReviewPane } = await server.ssrLoadModule("/src/components/TurnReviewPane.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const { client, SirusClient } = await server.ssrLoadModule("/src/client/index.ts");
  const file = { path: "src/<script>.ts", kind: "modified", additions: 2, deletions: 1, binary: false, diff: "--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1 +1,2 @@\n-old\n+new\n+<script>unsafe</script>\n" };
  const review = { files: [file, { ...file, path: "binary.bin", binary: true, additions: 0, deletions: 0, diff: null }, { ...file, path: "third.ts" }, { ...file, path: "fourth.ts" }], partial: false, sharedWorkspace: true, keptAt: null, expired: false };
  const activity = { provider: "codex", model: null, startedAt: 0, endedAt: 1, waitingSince: null, pausedMs: 0, status: "completed", items: [], truncated: false, review };
  const session = { id: "s", projectId: "p", title: "Fixture", agent: "codex", status: "completed", createdAt: "time", lastActivityAt: "time", worktree: { path: "/fixture", branch: "main", isolated: false }, messages: [{ id: "m", sessionId: "s", role: "agent", content: "Done", createdAt: "time", streaming: false, activity }] };
  const store = () => useAppStore.getState();
  const settings = store().settings;
  const nativeReview = globalThis.structuredClone(review);
  const calls = [];
  const fixtureClient = new SirusClient({ invoke: async (command, args) => { calls.push({ command, args }); return { ...nativeReview, keptAt: "accepted" }; }, listen: async () => () => {} });
  await fixtureClient.keepTurnChanges("s", "m");
  assert.deepEqual(calls, [{ command: "keep_turn_changes", args: { sessionId: "s", messageId: "m" } }]);
  useAppStore.setState({ sessions: [session], selectedSessionId: "s", dockPanes: [] });
  store().openTurnReview("s", "m", file.path);
  assert.equal(store().dockOpen, true);
  assert.equal(store().dockPanes[0].kind, "review");
  assert.equal(store().dockPanes[0].sessionId, "s");
  assert.equal(store().dockPanes[0].review.path, file.path);
  store().openTurnReview("s", "m", "third.ts");
  assert.equal(store().dockPanes.length, 1);
  assert.equal(store().dockPanes[0].review.path, "third.ts");
  store().openTurnReview("foreign", "m"); store().openTurnReview("s", "foreign"); store().openTurnReview("s", "m", "../foreign");
  assert.equal(store().dockPanes.length, 1);
  // A delayed native acknowledgment updates only acknowledgment metadata, preserving newer state.
  const originalKeep = client.keepTurnChanges;
  let settle;
  client.keepTurnChanges = () => new Promise((resolve) => { settle = resolve; });
  const pending = store().keepTurnChanges("s", "m");
  const newer = globalThis.structuredClone(session);
  newer.messages[0].activity.review.expired = true;
  newer.messages[0].activity.review.files[0].diff = null;
  newer.messages.push({ id: "next", sessionId: "s", role: "user", content: "Next", createdAt: "time", streaming: false });
  useAppStore.setState({ sessions: [newer] });
  settle({ ...nativeReview, keptAt: "accepted" }); await pending;
  assert.equal(store().sessions[0].messages.length, 2);
  assert.equal(store().sessions[0].messages[0].activity.review.expired, true);
  assert.equal(store().sessions[0].messages[0].activity.review.files[0].diff, null);
  assert.equal(store().sessions[0].messages[0].activity.review.keptAt, "accepted");
  client.keepTurnChanges = originalKeep;
  for (const locale of ["pt-BR", "en"]) {
    useAppStore.getInitialState().settings = { ...settings, locale };
    useAppStore.getInitialState().sessions = [session];
    const html = renderToString(createElement(TurnChangeSummary, { sessionId: "s", messageId: "m", review }));
    assert.ok(html.includes(locale === "pt-BR" ? "Manter" : "Keep"));
    assert.ok(html.includes(locale === "pt-BR" ? "Abrir diff" : "Open diff"));
    assert.ok(html.includes(locale === "pt-BR" ? "4 arquivos alterados" : "4 changed files"));
    // T3-style tree: folders start closed, top-level files show.
    assert.ok(html.includes('aria-expanded="false"') && html.includes('title="fourth.ts"'));
    // Undo (ADR-061) is offered only while a file still has a retained text diff.
    assert.ok(html.includes(locale === "pt-BR" ? "Desfazer" : "Undo"));
    const expired = renderToString(createElement(TurnChangeSummary, { sessionId: "s", messageId: "m", review: { ...review, expired: true } }));
    assert.ok(!expired.includes(locale === "pt-BR" ? ">Desfazer" : ">Undo"));
    assert.ok(!html.includes("<script>"), "file names are escaped");
    const kept = renderToString(createElement(TurnChangeSummary, { sessionId: "s", messageId: "m", review: { ...review, keptAt: "accepted" } }));
    assert.ok(kept.includes(locale === "pt-BR" ? "Mantidas" : "Kept"));
    assert.ok(kept.includes('disabled=""'));
    const historical = renderToString(createElement(TurnReviewPane, { sessionId: "s", messageId: "m", path: file.path }));
    assert.ok(historical.includes(locale === "pt-BR" ? "Diff histórico" : "Historical diff"));
    assert.ok(historical.includes("&lt;script&gt;unsafe&lt;/script&gt;") && !historical.includes("<script>unsafe"));
    assert.ok(historical.includes(locale === "pt-BR" ? "Workspace compartilhado" : "Shared workspace"));
    const binary = renderToString(createElement(TurnReviewPane, { sessionId: "s", messageId: "m", path: "binary.bin" }));
    assert.ok(binary.includes(locale === "pt-BR" ? "Arquivo binário" : "Binary file"));
  }
  // This response's retained data stays usable even when current git_status has unrelated files.
  useAppStore.setState({ gitStatus: { changes: [{ path: "unrelated.ts", kind: "modified", additions: 999, deletions: 999 }] } });
  assert.deepEqual(store().sessions[0].messages[0].activity.review.files.map((f) => f.path), review.files.map((f) => f.path));
  useAppStore.setState({ selectedSessionId: "another", dockPanes: [] });
  store().openTurnReview("s", "m");
  assert.equal(store().dockPanes.length, 0);
  console.log("Turn review: compact/localized/escaped historical summaries, owner-scoped dock and acknowledgment races verified.");
} finally { await server.close(); }
