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
    // Each file row is one full-width button whose name carries path, kind and +/− counts.
    const kind = locale === "pt-BR" ? "modificado" : "modified";
    assert.ok(html.includes(`aria-label="${locale === "pt-BR" ? "Revisar" : "Review"} fourth.ts, ${kind}, +2 −1"`), "turn file rows name path, kind and counts");
    assert.ok(html.includes(locale === "pt-BR" ? "Revisar binary.bin, modificado, Binário" : "Review binary.bin, modified, Binary"), "binary rows say so instead of counts");
    const kept = renderToString(createElement(TurnChangeSummary, { sessionId: "s", messageId: "m", review: { ...review, keptAt: "accepted" } }));
    assert.ok(kept.includes(locale === "pt-BR" ? "Mantidas" : "Kept"));
    assert.ok(kept.includes('disabled=""'));
    const historical = renderToString(createElement(TurnReviewPane, { sessionId: "s", messageId: "m", path: file.path }));
    assert.ok(historical.includes(locale === "pt-BR" ? "Diff histórico" : "Historical diff"));
    assert.ok(historical.includes("&lt;script&gt;unsafe&lt;/script&gt;") && !historical.includes("<script>unsafe"));
    assert.ok(historical.includes(locale === "pt-BR" ? "Workspace compartilhado" : "Shared workspace"));
    assert.ok(historical.includes(`aria-label="third.ts, ${kind}, +2 −1"`) && historical.includes("focus-visible:outline-2"), "review list rows are labelled full-width buttons");
    const binary = renderToString(createElement(TurnReviewPane, { sessionId: "s", messageId: "m", path: "binary.bin" }));
    assert.ok(binary.includes(locale === "pt-BR" ? "Arquivo binário" : "Binary file"));
  }
  // This response's retained data stays usable even when current git_status has unrelated files.
  useAppStore.setState({ gitStatus: { changes: [{ path: "unrelated.ts", kind: "modified", additions: 999, deletions: 999 }] } });
  assert.deepEqual(store().sessions[0].messages[0].activity.review.files.map((f) => f.path), review.files.map((f) => f.path));
  // Large diffs mount one chunk first and reserve the rest behind a sentinel.
  const { DiffViewer } = await server.ssrLoadModule("/src/components/DiffViewer.tsx");
  const { DIFF_CHUNK } = await server.ssrLoadModule("/src/lib/diff-window.ts");
  const bigDiff = `--- a/big.ts\n+++ b/big.ts\n@@ -0,0 +1,1000 @@\n${Array.from({ length: 1000 }, (_, i) => `+line ${i}`).join("\n")}\n`;
  const big = { path: "big.ts", kind: "modified", additions: 1000, deletions: 0 };
  const bigHtml = renderToString(createElement(DiffViewer, { changes: [big], selected: big, diff: bigDiff, onSelect: () => {} }));
  assert.equal(bigHtml.match(/data-diff-index=/g)?.length, DIFF_CHUNK, "only the first chunk is mounted");
  assert.ok(bigHtml.includes(`data-diff-index="${DIFF_CHUNK - 1}"`) && !bigHtml.includes(`data-diff-index="${DIFF_CHUNK}"`));
  const { reviewDiffLines } = await server.ssrLoadModule("/src/lib/diff-comment.ts");
  assert.ok(bigHtml.includes(`data-diff-pending="${reviewDiffLines(bigDiff).length - DIFF_CHUNK}"`), "the remaining rows are reserved behind the sentinel");
  const smallHtml = renderToString(createElement(DiffViewer, { changes: [file], selected: file, diff: file.diff, onSelect: () => {} }));
  assert.ok(!smallHtml.includes("data-diff-pending"), "short diffs mount whole");
  const untracked = (count) => `+++ untracked\n${Array.from({ length: count }, (_, i) => `const v${i} = ${i};`).join("\n")}\n`;
  assert.ok(!renderToString(createElement(DiffViewer, { changes: [big], selected: big, diff: untracked(10), onSelect: () => {} })).includes("data-diff-index"), "short untracked files keep the highlighted block");
  const longUntracked = renderToString(createElement(DiffViewer, { changes: [big], selected: big, diff: untracked(DIFF_CHUNK * 3), onSelect: () => {} }));
  assert.equal(longUntracked.match(/data-diff-index=/g)?.length, DIFF_CHUNK, "long untracked files use the chunked plain rows");
  useAppStore.setState({ selectedSessionId: "another", dockPanes: [] });
  store().openTurnReview("s", "m");
  assert.equal(store().dockPanes.length, 0);
  console.log("Turn review: compact/localized/escaped historical summaries, chunked large diffs, owner-scoped dock and acknowledgment races verified.");
} finally { await server.close(); }
