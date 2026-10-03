// Real component renders without starting providers, IPC or a browser.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { Switch } = await server.ssrLoadModule("/src/primitives/Switch.tsx");
  const { GeneralSettings } = await server.ssrLoadModule("/src/components/settings/GeneralSettings.tsx");
  const { EnvironmentPanel } = await server.ssrLoadModule("/src/components/EnvironmentPanel.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const { mergeSettings } = await server.ssrLoadModule("/src/lib/settings.ts");
  const { translate } = await server.ssrLoadModule("/src/i18n/index.ts");

  for (const checked of [false, true]) {
    const markup = renderToString(createElement(Switch, { checked, label: "Recording", onChange: () => {} }));
    assert.match(markup, /role="switch"/);
    assert.match(markup, new RegExp(`aria-checked="${checked}"`));
    assert.match(markup, /aria-label="Recording"/);
    assert.match(markup, /<ellipse/);
    const disabled = renderToString(createElement(Switch, { checked, disabled: true, label: "Unavailable", onChange: () => {} }));
    assert.match(disabled, / disabled=""/);
  }

  // SSR normally uses the bootstrap snapshot. Bind the disposable render process
  // to each fixture instead; effects and callbacks never run in these renders.
  const initialSnapshot = useAppStore.getInitialState();
  const setFixture = value => { Object.assign(initialSnapshot, value); useAppStore.setState(value); };
  const settings = mergeSettings({ locale: "pt-BR", showEnvironmentUsage: false });
  setFixture({ settings });
  const general = renderToString(createElement(GeneralSettings, { settings, agents: [], onSave: () => {} }));
  for (const key of ["General", "Core defaults", "Default provider", "Sidebar organization", "Project order", "Thread order", "Environment panel"]) {
    assert.notEqual(translate("pt-BR", key), key, `${key} is localized`);
    assert.ok(general.includes(translate("pt-BR", key)), `${key} renders`);
  }
  assert.equal(general.split(translate("pt-BR", "Restore defaults")).length - 1, 1, "one page-level reset");
  assert.doesNotMatch(general, /setting-reset|Restaurar padrão de /, "no per-row reset icons");
  assert.ok(general.includes(translate("pt-BR", "Choose defaults for new sessions, navigation and the Environment panel.")));
  const unchanged = renderToString(createElement(GeneralSettings, { settings: mergeSettings({}), agents: [], onSave: () => {} }));
  assert.match(unchanged, /<button[^>]*disabled=""[^>]*>[\s\S]*?Restaurar padrões[\s\S]*?<\/button>/, "page reset is disabled when already at defaults");
  assert.doesNotMatch(general, /role="tooltip"/);
  const dropdowns = [...general.matchAll(/<button[^>]*role="combobox"[^>]*>/g)].map(match => match[0]);
  assert.equal(dropdowns.length, 5, "all five General preferences use the real Arc select");
  assert.ok(dropdowns.every(trigger => trigger.includes("general-settings-select")), "all controls share the same size class");
  const labels = [...general.matchAll(/<label for="([^"]+)"[^>]*>([^<]+)<\/label>/g)];
  for (const key of ["Default provider", "New threads", "Language", "Project order", "Thread order"]) {
    const label = labels.find(match => match[2] === translate("pt-BR", key));
    assert.ok(label, `${key} retains a native label`);
    assert.ok(dropdowns.some(trigger => trigger.includes(`id="${label[1]}"`)), `${key} labels its dropdown`);
  }
  const providerLabel = labels.find(match => match[2] === translate("pt-BR", "Default provider"));
  const providerButton = general.match(new RegExp(`<button[^>]*id="${providerLabel[1]}"[^>]*>[\\s\\S]*?<\\/button>`))?.[0];
  assert.ok(providerButton?.includes("<img"), "selected provider retains its original decorative mark");
  assert.ok(providerButton?.includes("Codex"), "selected provider keeps its label even when its CLI is absent");
  assert.ok(!providerButton?.includes(translate("pt-BR", "Not detected")), "availability belongs to menu descriptions, not the selected label");

  const project = { id: "p", name: "Fixture", path: "/fixture", addedAt: "time", lastOpenedAt: "time" };
  const session = { id: "s", projectId: "p", agent: "codex", title: "Fixture", status: "idle", createdAt: "time", lastActivityAt: "time", worktree: { path: "/fixture", branch: "main", isolated: false }, pinnedMessageIds: ["pin"], messages: [{ id: "pin", sessionId: "s", role: "agent", content: "A pinned response", createdAt: "time", streaming: false }], lastError: null };
  setFixture({ projects: [project], sessions: [session], selectedProjectId: "p", selectedSessionId: "s", environmentOpen: true,
    contextTexts: { "session:s": "Notes for this session", "project:p": "Reference <script>alert(1)</script>" }, contextTextStatus: {} });
  for (const visible of [false, true]) {
    setFixture({ settings: mergeSettings({ locale: "en", showEnvironmentUsage: visible, showEnvironmentRepository: visible, showEnvironmentEditor: visible,
      showEnvironmentPinned: visible, showEnvironmentNotepad: visible, showEnvironmentInstructions: visible }) });
    const environment = renderToString(createElement(EnvironmentPanel));
    for (const title of ["Usage", "Repository", "Editor"]) assert.equal(environment.includes(`>${title}</p>`), visible, `${title} visibility`);
    assert.ok(environment.includes("Changes"), "workspace actions remain present");
    for (const title of ["Pinned messages", "Project instructions", "Notepad"]) assert.ok(!environment.includes(title), `${title} is absent even with retained visibility enabled`);
    assert.ok(!environment.includes("A pinned response") && !environment.includes("Notes for this session") && !environment.includes("Reference &lt;script&gt;"));
    assert.equal([...environment.matchAll(/<textarea/g)].length, 0);
    for (const key of ["Pinned messages", "Project instructions", "Notepad", "Context and notes"]) assert.ok(!general.includes(translate("pt-BR", key)), `${key} has no orphaned General visibility control`);

  }
  const other = { ...session, id: "other", messages: [], pinnedMessageIds: [] };
  setFixture({ sessions: [session, other], selectedSessionId: "other", contextTexts: { ...useAppStore.getState().contextTexts, "session:other": "Other session notes" } });
  const otherPanel = renderToString(createElement(EnvironmentPanel));
  assert.ok(!otherPanel.includes("Other session notes"));
  assert.ok(!otherPanel.includes("Notes for this session"));
  assert.ok(!otherPanel.includes("Reference &lt;script&gt;"));
  assert.equal(useAppStore.getState().contextTexts["session:s"], "Notes for this session", "removing the UI preserves retained notes");
  assert.deepEqual(useAppStore.getState().sessions[0].pinnedMessageIds, ["pin"], "existing assistant bookmarks are preserved");
  console.log("Orbit switch semantics, localized General and Environment visibility renders passed");
} finally {
  await server.close();
}
