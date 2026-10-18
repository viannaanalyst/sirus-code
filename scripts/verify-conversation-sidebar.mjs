import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { ConversationSidebar } = await server.ssrLoadModule("/src/components/ConversationSidebar.tsx");
  const { HeaderTabs } = await server.ssrLoadModule("/src/components/HeaderTabs.tsx");
  const { TooltipProvider } = await server.ssrLoadModule("/src/primitives/Tooltip.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const snapshot = useAppStore.getInitialState();
  snapshot.projects = ["alpha", "beta"].map(id => ({ id, name: `Project ${id}`, path: `/fixture/${id}`, addedAt: "time", lastOpenedAt: "time" }));
  const day = (n) => new Date(Date.UTC(2026, 0, n)).toISOString();
  const session = (id, projectId, n, extra = {}) => ({ id, title: `Session ${id}`, projectId, agent: id === "beta-new" ? "claude" : "codex", model: id === "beta-new" ? "claude-opus-4" : "gpt-5", status: "completed", createdAt: day(1), lastActivityAt: day(n), worktree: { path: "/fixture", branch: `branch/${id}`, isolated: true }, messages: [], lastError: null, ...extra });
  snapshot.sessions = [
    session("alpha-old", "alpha", 2),
    session("beta-old", "beta", 3),
    session("beta-new", "beta", 9),
    session("alpha-working", "alpha", 5, { status: "running" }),
    session("archived", "alpha", 8),
    session("side", "alpha", 8, { sideChat: { parentSessionId: "alpha-old" } }),
    session("snoozed", "alpha", 8, { snoozedUntil: "2999-01-01T00:00:00Z" }),
  ];
  snapshot.selectedProjectId = "alpha";
  snapshot.selectedSessionId = "alpha-old";
  snapshot.unseenSessionIds = ["beta-new"];
  const render = (node) => renderToString(createElement(TooltipProvider, null, node));
  for (const locale of ["pt-BR", "en"]) {
    for (const order of ["recent", "project"]) {
      snapshot.settings = { ...snapshot.settings, locale, archivedSessionIds: ["archived"], sidebarMode: "list", sidebarListOrder: order };
      snapshot.sidebarCollapsed = false;
      const html = render(createElement(ConversationSidebar));
      const rows = [...html.matchAll(/data-conversation="([^"]+)"/g)].map(match => match[1]);
      // Listed conversations only, flat by last activity or grouped by project (ADR-139).
      assert.deepEqual(rows, order === "recent" ? ["beta-new", "alpha-working", "beta-old", "alpha-old"] : ["beta-new", "beta-old", "alpha-working", "alpha-old"]);
      const headers = (html.match(/data-list-kind="project"/g) ?? []).length;
      assert.equal(headers, order === "project" ? 2 : 0);
      assert.ok(html.includes("branch/beta-new") && html.includes("Project alpha") && html.includes("Sirus") && html.includes("Code"));
      // Status: working pulse, unread dot, current row marked.
      assert.ok(html.includes('data-status="running"') && html.includes('data-status="unread"') && html.includes('aria-current="page"'));
      assert.ok(html.includes('data-unread="true"'), "the unread conversation reads stronger");
      // Search, project actions, nav row with Inbox / Tasks / PRs, Archived and Settings in the footer.
      assert.ok(html.includes("conversation-sidebar-search") && (html.match(/conversation-sidebar-tool(?!s)/g) ?? []).length === 3);
      assert.equal((html.match(/conversation-sidebar-nav-item/g) ?? []).length, 3);
      assert.ok(html.includes('data-section="settings"') && html.includes('role="separator"'));
      assert.ok(!/uppercase/.test(html), "labels are never forced into capitals");
    }
    // The header project switcher steps aside while the list shows; tabs stay.
    snapshot.settings = { ...snapshot.settings, locale, sidebarMode: "list", showSessionTabs: true };
    snapshot.openTabsByProject = { alpha: ["alpha-old"] };
    snapshot.mainView = "session";
    assert.ok(!render(createElement(HeaderTabs)).match(/class="[^"]*\bheader-project\b/));
    assert.ok(render(createElement(HeaderTabs)).includes('data-tab="alpha-old"'));
    snapshot.sidebarCollapsed = true;
    assert.ok(render(createElement(HeaderTabs)).match(/class="[^"]*\bheader-project\b/), "hidden with ⌘B, the switcher comes back");
    snapshot.settings = { ...snapshot.settings, sidebarMode: "rail" };
    snapshot.sidebarCollapsed = false;
    assert.ok(render(createElement(HeaderTabs)).match(/class="[^"]*\bheader-project\b/));
  }
  // A long list mounts only its first window of rows.
  snapshot.settings = { ...snapshot.settings, sidebarListOrder: "recent", archivedSessionIds: [] };
  snapshot.sessions = Array.from({ length: 300 }, (_, index) => session(`many-${index}`, index % 2 ? "alpha" : "beta", 1 + (index % 28)));
  const long = render(createElement(ConversationSidebar));
  const mounted = (long.match(/data-conversation=/g) ?? []).length;
  assert.ok(mounted > 0 && mounted <= 60, `windowed: ${mounted} rows mounted`);
  console.log("Conversation sidebar: listed conversations in Recent and By project order, status dots, search/actions/nav/footer, switcher hidden only while the list shows, long lists windowed, in both locales");
} finally { await server.close(); }
