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
      // Seven customizable rail items (ADR-052), the "more" menu and Settings.
      assert.equal((html.match(/data-section=/g) ?? []).length, 9);
      assert.ok(!html.includes('data-section="drafts"') && html.includes('data-section="more"'));
      const gear = html.match(/<button[^>]*data-section="settings"[^>]*>/)?.[0];
      assert.ok(gear && !gear.includes("aria-expanded") && !gear.includes("aria-controls"), "Settings is a direct page action, not a sidebar panel trigger");
      assert.ok(html.includes('aria-expanded="false"') && !html.includes('data-section="projects"'));
      assert.ok(!html.includes("Session foreign") && !html.includes("Session archived"));
      if (collapsed) assert.ok(!html.includes('id="sidebar-docked"') && !html.includes("Session draft"));
      else {
        assert.ok(html.includes('id="sidebar-docked"') && html.includes("Session draft") && html.includes("Session recent"));
        assert.ok(!html.includes("sidebar-activity-second") && !html.includes("branch/draft"));
        assert.ok(!html.includes("sidebar-scope") && !html.includes("sidebar-section-heading") && !html.includes("data-open-project"));
        assert.ok(html.includes("sidebar-project-group") && html.includes("sidebar-folder-glyph"));
        assert.ok(!html.includes(locale === "pt-BR" ? "Ordenar sessões" : "Sort sessions"));
        assert.ok(!html.includes("sidebar-panel-footer"));
        assert.ok(!html.includes(locale === "pt-BR" ? "Recolher barra lateral" : "Collapse sidebar"));
        const header = html.slice(html.indexOf("sidebar-panel-header"), html.indexOf("sidebar-new-thread"));
        assert.ok(header.includes("Sirus Code") && !header.includes("Fixture project"), "the header shows the fixed product name, not the selected project");
      }
    }
  }
  console.log("Sidebar rail: customizable rail items, more menu and Settings, owned project folders/title-only sessions/drafts, clean header, collapsed rail and accessible labels pass in both locales");
} finally { await server.close(); }
