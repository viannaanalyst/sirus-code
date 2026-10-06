import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
const originalDocument = globalThis.document;
// Native dictation reads only visibility during its initial render.
globalThis.document = { hidden: false };
try {
  const { SessionPane } = await server.ssrLoadModule("/src/components/SessionPane.tsx");
  const { TurnReviewPane } = await server.ssrLoadModule("/src/components/TurnReviewPane.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const file = { path: "src/login.ts", kind: "modified", additions: 1, deletions: 1, binary: false, diff: "--- a/src/login.ts\n+++ b/src/login.ts\n@@ -1 +1 @@\n-old\n+<script>login</script>\n" };
  const review = { files: [file], partial: false, sharedWorkspace: false, expired: false, keptAt: null };
  const session = { id: "s", projectId: "p", title: "Fixture", agent: "codex", status: "completed", createdAt: "time", lastActivityAt: "time", lastError: null, worktree: { path: "/fixture", branch: "main", isolated: false }, messages: [{ id: "m", sessionId: "s", role: "agent", content: "LOGIN\n```ts\n<script>login</script>\n```", createdAt: "time", streaming: false, activity: { provider: "codex", startedAt: 0, endedAt: 1, waitingSince: null, pausedMs: 0, status: "completed", items: [], truncated: false, review } }] };
  const initial = useAppStore.getInitialState();
  for (const locale of ["pt-BR", "en"]) {
    Object.assign(initial, { sessions: [session], projects: [{ id: "p", name: "Fixture", path: "/fixture", addedAt: "time", lastOpenedAt: "time" }], selectedSessionId: "s", settings: { ...initial.settings, locale }, transcriptSearch: { scope: "session", query: "login", revision: 1 } });
    const html = renderToString(createElement(SessionPane, { session, agents: [], onSend: async () => false, onStop: () => {}, onNewSession: () => {} }));
    assert.ok(html.includes('role="search"'));
    assert.ok(html.includes(locale === "pt-BR" ? "Buscar na conversa" : "Find in conversation"));
    assert.ok(html.includes('data-search-start="0"') && html.includes('data-search-start="14"'), "prose and code matches have the same offsets as search navigation");
    assert.ok(html.includes("&lt;script&gt;") && !html.includes("<script>login</script>"));
    const historical = renderToString(createElement(TurnReviewPane, { sessionId: "s", messageId: "m" }));
    assert.ok(historical.includes(locale === "pt-BR" ? 'aria-label="Selecionar linha antiga 1, nova —"' : 'aria-label="Select old line 1, new line —"'), historical);
    review.expired = true;
    const expired = renderToString(createElement(TurnReviewPane, { sessionId: "s", messageId: "m" }));
    assert.ok(!expired.includes(locale === "pt-BR" ? 'aria-label="Selecionar linha' : 'aria-label="Select old line'), "expired reviews never expose comment actions");
    review.expired = false;
  }
  console.log("Conversation tools: localized search, matching prose/code offsets, escaped content and retained-only diff selection verified.");
} finally {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  await server.close();
}
