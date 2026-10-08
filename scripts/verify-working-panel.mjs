import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { WorkingPanel } = await server.ssrLoadModule("/src/components/WorkingPanel.tsx");
  const { TooltipProvider } = await server.ssrLoadModule("/src/primitives/Tooltip.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const snapshot = useAppStore.getInitialState();
  snapshot.projects = [{ id: "p", name: "dp-inchurch", path: "/fixture", addedAt: "time", lastOpenedAt: "time", look: { emoji: "🚀" } }];
  const session = (id, status, agent, at) => ({ id, title: `Session ${id}`, projectId: "p", agent, model: null, status, createdAt: at, lastActivityAt: at, worktree: { path: "/fixture", branch: "main", isolated: false },
    messages: [{ id: `${id}-m`, sessionId: id, role: "agent", content: "", createdAt: at, streaming: true, activity: { provider: agent, model: null, startedAt: Date.parse(at), endedAt: null, waitingSince: null, pausedMs: 0, status, items: [], truncated: false } }], lastError: null });
  const render = () => renderToString(createElement(TooltipProvider, null, createElement(WorkingPanel, { now: Date.parse("2026-10-08T00:01:00Z") })));
  for (const locale of ["pt-BR", "en"]) {
    snapshot.settings = { ...snapshot.settings, locale, showWorkingPanel: true, archivedSessionIds: [] };
    snapshot.sessions = [session("one", "running", "claude", "2026-10-08T00:00:00Z")];
    assert.equal(render(), "", "one session in flight shows nothing");
    snapshot.sessions = [session("a", "running", "claude", "2026-10-08T00:00:10Z"), session("b", "waiting", "codex", "2026-10-08T00:00:30Z"), session("c", "idle", "codex", "2026-10-08T00:00:00Z")];
    const html = render();
    assert.ok(html.includes("data-working-panel"), "two in flight show the panel");
    assert.equal((html.match(/working-panel-row/g) ?? []).length, 2, "idle sessions are left out");
    assert.ok(html.indexOf("Session b") < html.indexOf("Session a"), "waiting sessions come first");
    assert.ok(html.includes("🚀") && html.includes("dp-inchurch"), "project icon and name");
    assert.ok(html.includes(locale === "pt-BR" ? "Trabalhando" : "Working"));
    snapshot.sessions = ["a", "b", "c", "d", "e", "f"].map((id, index) => session(id, "running", "claude", `2026-10-08T00:00:0${index}Z`));
    const many = render();
    assert.equal((many.match(/working-panel-row"/g) ?? []).length, 4, "four rows before +N more");
    assert.ok(many.includes(locale === "pt-BR" ? "mais 2" : "2 more"));
    snapshot.settings = { ...snapshot.settings, showWorkingPanel: false };
    assert.equal(render(), "", "the Chat behavior switch turns it off");
  }
  console.log("Working panel: hidden below two sessions or when switched off; provider/project icons, waiting first, four rows and +N more in both locales");
} finally { await server.close(); }
