import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
const originalDocument = globalThis.document;
globalThis.document = { hidden: false };
try {
  const { AgentComposer } = await server.ssrLoadModule("/src/components/AgentComposer.tsx");
  const { ComposerPromptQueue } = await server.ssrLoadModule("/src/components/ComposerPromptQueue.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const initial = useAppStore.getInitialState();
  const session = { id: "s", projectId: "p", agent: "codex", model: "model", status: "running", messages: [], worktree: { path: "/fixture", isolated: true } };
  const item = { id: "q", text: "<script>queued request</script>", prompt: "Request", context: { attachments: [], goal: "", planning: true }, execution: { approval: "ask" }, binding: { model: "model", agent: "codex" } };
  for (const locale of ["pt-BR", "en"]) {
    Object.assign(initial, { sessions: [session], selectedSessionId: "s", selectedProjectId: "p", agents: [{ id: "codex", installed: true }], settings: { ...initial.settings, locale }, composerDrafts: { "session:s": "Next request" }, promptQueues: { s: { items: [item], paused: false, waitingFor: "answer" } } });
    const html = renderToString(createElement(AgentComposer, { session, agents: [], onSend: async () => false, onStop: () => {} }));
    assert.ok(html.includes(locale === "pt-BR" ? 'aria-label="Adicionar à fila"' : 'aria-label="Add to queue"'));
    assert.ok(html.includes(locale === "pt-BR" ? 'aria-label="Parar agente"' : 'aria-label="Stop agent"'), "Stop remains available beside Add to queue");
    assert.ok(html.includes("&lt;script&gt;queued request&lt;/script&gt;") && !html.includes("<script>queued request</script>"));
    assert.ok(html.includes(locale === "pt-BR" ? "Modo planejamento" : "Planning mode"));
    const queueLabel = locale === "pt-BR" ? 'aria-label="Adicionar à fila"' : 'aria-label="Add to queue"';
    const stopLabel = locale === "pt-BR" ? 'aria-label="Parar agente"' : 'aria-label="Stop agent"';
    for (const draft of ["", " \n\t "]) {
      initial.composerDrafts["session:s"] = draft;
      const empty = renderToString(createElement(AgentComposer, { session, agents: [], onSend: async () => false, onStop: () => {} }));
      assert.ok(!empty.includes(queueLabel), "Empty and whitespace-only drafts hide Add to queue");
      assert.ok(empty.includes(stopLabel), "Stop remains available with an empty draft");
    }
    initial.promptQueues.s.paused = true;
    initial.promptQueues.s.reason = "queue.failed";
    const paused = renderToString(createElement(ComposerPromptQueue, { sessionId: "s" }));
    assert.ok(paused.includes(locale === "pt-BR" ? "Continuar fila" : "Continue queue"));
    initial.promptQueues = {};
    assert.equal(renderToString(createElement(ComposerPromptQueue, { sessionId: "s" })), "");
    const idleSession = { ...session, status: "idle" };
    initial.sessions = [idleSession];
    initial.composerDrafts["session:s"] = "";
    const idle = renderToString(createElement(AgentComposer, { session: idleSession, agents: [], onSend: async () => false, onStop: () => {} }));
    assert.ok(idle.includes(locale === "pt-BR" ? 'aria-label="Enviar"' : 'aria-label="Send"'), "The ordinary Send control remains in an idle composer");
    initial.promptQueues = { s: { items: [item], paused: true, reason: "queue.failed" } };
    const queuedEmpty = renderToString(createElement(AgentComposer, { session: idleSession, agents: [], onSend: async () => false, onStop: () => {} }));
    assert.ok(!queuedEmpty.includes(queueLabel), "An existing paused queue does not show Add to queue without text");
  }
  console.log("Request queue controls, localization and escaped content verified.");
} finally {
  globalThis.document = originalDocument;
  await server.close();
}
