import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { ConversationSidebar } = await server.ssrLoadModule("/src/components/ConversationSidebar.tsx");
  const { HeaderTabs } = await server.ssrLoadModule("/src/components/HeaderTabs.tsx");
  const { TooltipProvider } = await server.ssrLoadModule("/src/primitives/Tooltip.tsx");
  const { SidebarStylePicker } = await server.ssrLoadModule("/src/components/settings/SidebarStylePicker.tsx");
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
    session("side", "alpha", 8, { sideChat: { parentSessionId: "alpha-old" } }),
    session("snoozed", "alpha", 8, { snoozedUntil: "2999-01-01T00:00:00Z" }),
  ];
  snapshot.selectedProjectId = "alpha";
  snapshot.selectedSessionId = "alpha-old";
  snapshot.unseenSessionIds = ["beta-new"];
  const render = (node) => renderToString(createElement(TooltipProvider, null, node));
  for (const locale of ["pt-BR", "en"]) {
    for (const order of ["recent", "project"]) {
      snapshot.settings = { ...snapshot.settings, locale, sidebarMode: "list", sidebarListOrder: order, sidebarOpenFolders: null };
      snapshot.sidebarCollapsed = false;
      const html = render(createElement(ConversationSidebar));
      const rows = [...html.matchAll(/data-conversation="([^"]+)"/g)].map(match => match[1]);
      // Listed conversations only, flat by last activity, or project folders where only the
      // selected project's folder starts open (ADR-139, round 2).
      assert.deepEqual(rows, order === "recent" ? ["beta-new", "alpha-working", "beta-old", "alpha-old"] : ["alpha-working", "alpha-old"]);
      const folders = [...html.matchAll(/aria-expanded="(true|false)" aria-label="([^"]+)"/g)].map(match => `${match[1]}:${match[2].split(",")[0]}`);
      assert.deepEqual(folders, order === "project" ? ["false:Project beta", "true:Project alpha"] : []);
      assert.equal((html.match(/data-list-kind="folder"/g) ?? []).length, order === "project" ? 2 : 0);
      // Right-clicking a folder opens its project's menu (the list's one menu reads this mark).
      assert.equal((html.match(/data-project-folder="/g) ?? []).length, order === "project" ? 2 : 0);
      // Rows in a folder leave the project line out.
      assert.equal(html.includes("conversation-row-project"), order === "recent");
      assert.ok(html.includes("Project alpha") && html.includes("Sirus") && html.includes("Code"));
      assert.ok(html.includes(order === "recent" ? "branch/beta-new" : "branch/alpha-working"));
      // Status: working pulse, unread dot (on the folder in By project), current row marked.
      assert.ok(html.includes('data-status="running"') && html.includes('data-status="unread"') && html.includes('aria-current="page"'));
      if (order === "recent") assert.ok(html.includes('data-unread="true"'), "the unread conversation reads stronger");
      // Search, order, New project and New conversation (no separate Open project), nav row, Usage and Settings.
      assert.ok(html.includes("conversation-sidebar-search") && (html.match(/conversation-sidebar-tool(?!s)/g) ?? []).length === 3);
      assert.ok(!html.includes('aria-label="Open Project"') && !html.includes('aria-label="Abrir projeto"'));
      assert.equal((html.match(/conversation-sidebar-nav-item/g) ?? []).length, 3);
      assert.ok(html.includes('data-section="settings"'), "Settings at the foot; the column has no resize handle");
      assert.ok(!html.includes("conversation-strip") && !html.includes("conversation-sidebar-project"));
      assert.ok(!/uppercase/.test(html), "labels are never forced into capitals");
    }
    // Saved open folders win; every folder closed stays closed.
    snapshot.settings = { ...snapshot.settings, sidebarListOrder: "project", sidebarOpenFolders: ["beta"] };
    assert.deepEqual([...render(createElement(ConversationSidebar)).matchAll(/data-conversation="([^"]+)"/g)].map(match => match[1]), ["beta-new", "beta-old"]);
    snapshot.settings = { ...snapshot.settings, sidebarOpenFolders: [] };
    assert.ok(!render(createElement(ConversationSidebar)).includes("data-conversation="));

    // Settings → Appearance → Sidebar: two radio cards (no Hidden: ⌘B hides either style) with still miniatures of the person's projects.
    const picker = render(createElement(SidebarStylePicker, { value: "list", onChange: () => {} }));
    assert.equal((picker.match(/type="radio"/g) ?? []).length, 2);
    assert.equal((picker.match(/sidebar-thumb-scene/g) ?? []).length, 2);
    assert.ok(/checked="" value="list"/.test(picker) && picker.includes("Project alpha") && picker.includes("Session alpha-old"));
    assert.ok(picker.includes(locale === "en" ? "Conversation list" : "Lista de conversas") && !/uppercase/.test(picker));
    assert.ok(!/<button/.test(picker), "the miniatures hold no controls");
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
  snapshot.settings = { ...snapshot.settings, sidebarListOrder: "recent" };
  snapshot.sessions = Array.from({ length: 300 }, (_, index) => session(`many-${index}`, index % 2 ? "alpha" : "beta", 1 + (index % 28)));
  const long = render(createElement(ConversationSidebar));
  const mounted = (long.match(/data-conversation=/g) ?? []).length;
  assert.ok(mounted > 0 && mounted <= 60, `windowed: ${mounted} rows mounted`);
  console.log("Conversation sidebar: Recent and folder-only By project (open state saved), the shared project menu on folders, status dots, search/order/New project/nav/footer, header switcher hidden while a column shows, Settings miniatures, long lists windowed, in both locales");
} finally { await server.close(); }
