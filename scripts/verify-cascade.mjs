import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

// Popups portal into document.body, which SSR has not got; render them in place instead.
const inlinePortal = {
  name: "inline-radix-portal",
  enforce: "pre",
  resolveId: id => id === "@radix-ui/react-portal" ? "\0inline-radix-portal" : null,
  load: id => id === "\0inline-radix-portal" ? "export const Portal = ({ children }) => children;\nexport const Root = Portal;\n" : null,
};
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom", plugins: [inlinePortal], ssr: { noExternal: [/^@radix-ui\//] }, logLevel: "error" });
const indices = html => [...html.matchAll(/data-cascade-item=""[^>]*?--cascade-index:(\d+)/g)].map(match => Number(match[1]));
const tag = (html, pattern) => html.match(new RegExp(`<[^>]*${pattern}[^>]*>`))?.[0] ?? "";
try {
  const { HeaderTabs } = await server.ssrLoadModule("/src/components/HeaderTabs.tsx");
  const { EnvironmentPanel } = await server.ssrLoadModule("/src/components/EnvironmentPanel.tsx");
  const { SettingsSidebar } = await server.ssrLoadModule("/src/components/settings/SettingsSidebar.tsx");
  const { TooltipProvider } = await server.ssrLoadModule("/src/primitives/Tooltip.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const { CASCADE_CAP, CASCADE_WINDOW_MS } = await server.ssrLoadModule("/src/lib/cascade.ts");
  const snapshot = useAppStore.getInitialState();
  snapshot.projects = Array.from({ length: 13 }, (_, index) => ({ id: `p${index}`, name: `Project ${index}`, path: `/fixture/${index}`, addedAt: "time", lastOpenedAt: "time" }));
  snapshot.sessions = ["one", "two", "three"].map(id => ({ id, title: `Session ${id}`, projectId: "p0", agent: "codex", model: "gpt-6-luna", status: "idle", createdAt: "time", lastActivityAt: "time", worktree: { path: "/fixture/0", branch: `branch/${id}`, isolated: false }, messages: [], lastError: null }));
  snapshot.selectedProjectId = "p0";
  snapshot.selectedSessionId = "one";
  const render = element => renderToString(createElement(TooltipProvider, null, element));

  // Project switcher: project rows, the footer actions and the session column cascade; the search leads.
  snapshot.projectSwitcherOpen = true;
  const switcher = render(createElement(HeaderTabs));
  const box = tag(switcher, 'class="[^"]*header-switcher[ "]');
  assert.ok(box.includes('data-popup=""') && box.includes('data-cascade=""'), "the switcher is a popup box that cascades on open");
  assert.ok(!tag(switcher, 'class="header-switcher-search"').includes("data-cascade-item"), "the search field is not part of the cascade");
  const rows = [...switcher.matchAll(/<button[^>]*class="header-switcher-row"[^>]*>/g)].map(match => match[0]);
  assert.equal(rows.length, 13);
  assert.deepEqual(rows.map(row => Number(row.match(/--cascade-index:(\d+)/)?.[1])), [...Array(11).keys(), 10, 10], "project rows count up and stop at the cap");
  assert.ok([...switcher.matchAll(/<button[^>]*class="header-switcher-footer[^"]*"[^>]*>/g)].every(match => /data-cascade-item=""[^>]*--cascade-index:10/.test(match[0])), "footer actions follow the rows");
  assert.ok(tag(switcher, 'class="header-switcher-title"').includes('data-cascade-item=""'), "the session column title leads its rows");
  assert.deepEqual([...switcher.matchAll(/class="header-switcher-session"[^>]*>/g)].map(match => Number(match[0].match(/--cascade-index:(\d+)/)?.[1])), [1, 2, 3], "session rows follow the column title");

  // Snoozed conversations (ADR-103) leave the session rows for a group at the end of the column:
  // its toggle and rows follow the rows in the cascade, each with a moon, the title and a countdown.
  // A turn that starts in a snoozed conversation brings it back to the rows.
  const rowsBefore = snapshot.sessions;
  const later = new Date(Date.now() + (2 * 60 + 10) * 60_000 - 30_000).toISOString();
  snapshot.sessions = [...rowsBefore, { ...rowsBefore[0], id: "four", title: "Session four", status: "completed", snoozedUntil: later }, { ...rowsBefore[0], id: "five", title: "Session five", status: "running", snoozedUntil: later }];
  const withSnoozed = render(createElement(HeaderTabs));
  assert.deepEqual([...withSnoozed.matchAll(/class="header-switcher-session"[^>]*>/g)].map(match => match[0].match(/data-session-row="(\w+)"/)?.[1]), ["one", "two", "three", "five"], "a snoozed conversation leaves the rows; a running one stays");
  const group = tag(withSnoozed, 'class="header-switcher-snoozed"');
  assert.ok(group.includes('role="group"') && /aria-label="(Snoozed|Adiadas) \(1\)"/.test(group), "the group names its count");
  const toggle = tag(withSnoozed, 'class="header-switcher-snoozed-toggle"');
  assert.ok(toggle.includes('aria-expanded="true"') && /--cascade-index:5/.test(toggle), "the group toggle follows the rows");
  const snoozedRow = withSnoozed.slice(withSnoozed.indexOf('class="header-switcher-session header-switcher-snoozed-row"'));
  assert.ok(/data-session-row="four"[^>]*--cascade-index:6/.test(tag(withSnoozed, 'class="header-switcher-session header-switcher-snoozed-row"')), "snoozed rows follow the toggle");
  assert.ok(/Session four/.test(snoozedRow) && /(back in|volta em) 2 h 10 min/.test(snoozedRow), "the row shows its title and a live countdown");
  assert.ok(/aria-label="(Return now|Voltar agora)"/.test(snoozedRow) && /aria-label="(Change time|Mudar horário)"/.test(snoozedRow), "the row offers Return now and Change time");
  assert.ok(!/class="header-tab"[^>]*data-tab="four"/.test(withSnoozed), "a snoozed conversation has no header tab");
  snapshot.sessions = rowsBefore;

  snapshot.projectSwitcherOpen = false;
  assert.ok(!render(createElement(HeaderTabs)).includes("data-cascade"), "a closed switcher renders no cascade");

  // Environment card: its rows and section labels are the direct children of a cascading column.
  snapshot.environmentOpen = true;
  snapshot.settings = { ...snapshot.settings, showEnvironmentRepository: true, showEnvironmentEditor: true };
  const card = render(createElement(EnvironmentPanel));
  assert.ok(tag(card, 'class="floating-material pointer-events-auto').includes('data-popup=""'), "the card leads its rows like a popup box");
  assert.ok(card.includes('data-cascade="children"'), "the card's rows cascade when it opens");
  assert.ok(!card.includes("data-environment-popover"), "row popovers stay closed until clicked");

  // Settings sidebar: back, group labels and pages, in order, capped.
  const sidebar = render(createElement(SettingsSidebar, { section: "general", onSection() {}, onBack() {}, query: "", onQuery() {}, matched: null }));
  assert.ok(tag(sidebar, 'class="settings-nav ').includes('data-cascade=""'), "the Settings menu cascades when it mounts");
  const order = indices(sidebar);
  assert.ok(order.length > 12 && order.every((value, index) => value === Math.min(index, CASCADE_CAP)), "Settings rows count up in order and stop at the cap");
  assert.ok(!tag(sidebar, 'class="settings-search"').includes("data-cascade-item"), "the Settings search is not part of the cascade");

  // Shared CSS: one keyframe, capped delays, popups on keyframes, and every motion switch respected.
  const motion = readFileSync("src/styles/motion.css", "utf8");
  assert.ok(/@keyframes cascade-in \{ from \{ opacity: 0; translate: -10px 0; \} \}/.test(motion), "the shared cascade is the sidebar's slide");
  assert.ok(motion.includes(`min(var(--cascade-index, 0), ${CASCADE_CAP}) * var(--motion-stagger)`), "the cascade delay is capped");
  assert.ok(motion.includes(':nth-child(n+11) { --cascade-index: 10; }'), "positional rows past the tenth share its delay");
  assert.ok(/\[data-popup\]\[data-state="open"\] \{ animation: popup-in var\(--motion-popup\)/.test(motion) && /@keyframes popup-in \{ from \{ opacity: 0; scale: \.96; \} \}/.test(motion), "popup boxes enter with a soft scale keyframe");
  assert.ok(/\[data-popup\]\[data-state="closed"\] \{ animation: popup-out var\(--motion-popup-exit\)/.test(motion), "popup boxes leave with a quick fade");
  assert.ok(/html:is\(\[data-animations="off"\], \[data-reduce-motion="on"\]\) :is\(\[data-popup\], \[data-cascade\] \[data-cascade-item\]/.test(motion), "the app's motion switches turn the entrance off");
  assert.ok(/@media \(prefers-reduced-motion: reduce\) \{\n {2}:is\(\[data-cascade\][^{]*\{ animation: none; \}\n {2}\[data-popup\]\[data-state="open"\] \{ animation-name: popup-fade-in; \}/.test(motion), "reduced motion keeps only a fade");
  const tokens = readFileSync("src/styles/index.css", "utf8");
  assert.ok(tokens.includes("--motion-popup: 160ms;") && tokens.includes("--motion-popup-exit: 100ms;") && tokens.includes("--cascade-lead: 40ms;"));
  assert.ok(CASCADE_WINDOW_MS >= 40 + CASCADE_CAP * 22 + 320, "the cascade window outlasts the last row");
  for (const file of ["src/components/arc/popover/popover.module.css", "src/components/arc/dropdown-menu/dropdown-menu.module.css"]) assert.ok(!readFileSync(file, "utf8").includes("@starting-style"), `${file} leaves the entrance to the shared keyframes`);
  assert.ok(!readFileSync("src/styles/sidebar.css", "utf8").includes("@keyframes sidebar-cascade-in"), "the sidebar uses the shared cascade");
  console.log("Cascade: switcher (with its Snoozed group), Environment card and Settings menu cascade on open with capped indices; popups enter on shared keyframes and respect motion settings");
} finally { await server.close(); }
