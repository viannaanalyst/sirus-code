import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { MessageTrail } = await server.ssrLoadModule("/src/components/MessageTrail.tsx");
  const { SessionPane } = await server.ssrLoadModule("/src/components/SessionPane.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const messages = [
    { id: "first", sessionId: "s", role: "user", content: "<script>pedido</script>", createdAt: "2026-10-02T12:00:00Z", streaming: false },
    { id: "reply", sessionId: "s", role: "agent", content: "Resposta", createdAt: "2026-10-02T12:00:00Z", streaming: false },
    { id: "second", sessionId: "s", role: "user", content: "Outro assunto", createdAt: "2026-10-02T12:00:00Z", streaming: false },
  ];
  const refs = { viewport: { current: null }, content: { current: null }, nodes: { current: new Map() }, onSelect: () => {} };
  for (const locale of ["pt-BR", "en"]) {
    useAppStore.getInitialState().settings = { ...useAppStore.getInitialState().settings, locale };
    const html = renderToString(createElement(MessageTrail, { ...refs, messages }));
    assert.ok(html.includes(locale === "pt-BR" ? "Tópicos da conversa" : "Conversation topics"));
    assert.ok(html.includes(locale === "pt-BR" ? "Mensagem 1:" : "Message 1:"));
    assert.equal((html.match(/data-trail-message=/g) ?? []).length, 2);
    assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1, "The rail adds a single Tab stop");
    assert.ok(html.includes("&lt;script&gt;pedido&lt;/script&gt;") && !html.includes("<script>pedido"));
    assert.ok(!html.includes('data-trail-message="reply"'));
    assert.equal(renderToString(createElement(MessageTrail, { ...refs, messages: messages.slice(0, 2) })), "");
  }
  const session = { id: "s", projectId: "p", title: "Fixture", agent: "codex", status: "completed", createdAt: "2026-10-02T12:00:00Z", lastActivityAt: "2026-10-02T12:00:00Z", worktree: { path: "/fixture", branch: "main", isolated: false }, messages };
  // The native dictation button reads visibility during its initial render.
  const originalDocument = globalThis.document;
  globalThis.document = { hidden: false };
  let pane;
  // SessionPane selects the current session itself; server rendering reads the initial state.
  Object.assign(useAppStore.getInitialState(), { sessions: [session], selectedSessionId: "s" });
  try { pane = renderToString(createElement(SessionPane, { agents: [], onSend: async () => false, onStop: () => {}, onNewSession: () => {} })); }
  finally { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; }
  assert.ok(pane.includes('data-message-id="first"') && pane.includes('data-message-id="reply"'));
  assert.ok(pane.includes("transcript-shell") && pane.includes("message-trail"));
  console.log("Message trail: real transcript integration, localized/escaped requests and one keyboard Tab stop verified.");
} finally { await server.close(); }
