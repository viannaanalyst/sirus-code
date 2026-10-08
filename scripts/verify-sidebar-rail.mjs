import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { Sidebar } = await server.ssrLoadModule("/src/components/Sidebar.tsx");
  const { TooltipProvider } = await server.ssrLoadModule("/src/primitives/Tooltip.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const snapshot = useAppStore.getInitialState();
  snapshot.projects = [{ id: "owned", name: "Fixture project", path: "/fixture", addedAt: "time", lastOpenedAt: "time" }];
  snapshot.sessions = ["draft", "recent", "archived", "foreign"].map(id => ({ id, title: `Session ${id}`, projectId: id === "foreign" ? "foreign" : "owned", agent: "codex", model: "gpt-6-luna", status: "running", createdAt: "time", lastActivityAt: "time", worktree: { path: "/fixture", branch: `branch/${id}`, isolated: true }, messages: [], lastError: null }));
  snapshot.selectedProjectId = "owned";
  snapshot.composerDrafts = { "session:draft": "unsent" };
  for (const locale of ["pt-BR", "en"]) {
    snapshot.settings = { ...snapshot.settings, locale, archivedSessionIds: ["archived"] };
    for (const collapsed of [false, true]) {
      snapshot.sidebarCollapsed = collapsed;
      const html = renderToString(createElement(TooltipProvider, null, createElement(Sidebar)));
      // Six customizable rail items (ADR-052), the "more" menu and Settings.
      assert.equal((html.match(/data-section=/g) ?? []).length, 8);
      assert.ok(!html.includes('data-section="drafts"') && !html.includes('data-section="automations"') && html.includes('data-section="more"'));
      const gear = html.match(/<button[^>]*data-section="settings"[^>]*>/)?.[0];
      assert.ok(gear && !gear.includes("aria-expanded") && !gear.includes("aria-controls"), "Settings is a direct page action, not a sidebar panel trigger");
      // The rail is the whole sidebar (ADR-092): no panel, no project or session rows, in either state.
      assert.ok(!html.includes('id="sidebar-docked"') && !html.includes("sidebar-peek") && !html.includes('data-section="projects"'));
      assert.ok(!html.includes("Session draft") && !html.includes("Session recent") && !html.includes("Session foreign") && !html.includes("Session archived"));
      assert.ok(!html.includes("sidebar-project-group") && !html.includes("sidebar-panel-header"));
      assert.ok(html.includes('data-section="home"') && html.includes('aria-current="page"'), "Home is current in the conversation view");
    }
  }
  console.log("Sidebar rail: customizable rail items, more menu and Settings, rail only with no project or session panel (ADR-092), accessible labels pass in both locales");
} finally { await server.close(); }
