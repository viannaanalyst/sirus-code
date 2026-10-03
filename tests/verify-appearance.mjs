// Actual component SSR, with no GUI, IPC or provider process.
import console from "node:console";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { AppearanceSettings } = await server.ssrLoadModule("/src/components/settings/AppearanceSettings.tsx");
  const { SettingsPanels } = await server.ssrLoadModule("/src/components/settings/SettingsPanels.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const { mergeSettings } = await server.ssrLoadModule("/src/lib/settings.ts");
  const { translate } = await server.ssrLoadModule("/src/i18n/index.ts");
  for (const locale of ["en", "pt-BR"]) for (const supported of [true, false]) for (const theme of ["dark", "light", "translucent"]) {
    const settings = mergeSettings({ locale, theme, darkSidebarTranslucent: true, lightSidebarTranslucent: true });
    Object.assign(useAppStore.getInitialState(), { settings }); useAppStore.setState({ settings });
    const host = { appearanceSupport: { translucency: supported, dockIcon: supported } };
    const markup = renderToString(createElement(AppearanceSettings, { settings, host, onSave: () => {} }));
    for (const key of ["Appearance", "UI font", "UI font size", "Code font", "Code font size", "Terminal font", "Terminal font size", "Dock icon", "Font smoothing", "Use system UI font"]) {
      assert.ok(markup.includes(translate(locale, key)), `${key} localized/rendered for ${locale}`);
      if (locale === "pt-BR") assert.notEqual(translate(locale, key), key);
    }
    assert.equal(markup.split(translate(locale, "Restore defaults")).length - 1, 1, "one page-level reset");
    const labels = [...markup.matchAll(/<label for="([^"]+)"[^>]*>([^<]+)<\/label>/g)];
    for (const key of ["Theme", "UI font", "UI font size", "Code font", "Code font size", "Terminal font", "Terminal font size", "UI density", "Composer line speed"]) {
      const label = labels.find(match => match[2] === translate(locale, key)); assert.ok(label, `${key} native label`);
      const trigger = markup.match(new RegExp(`<button[^>]*id="${label[1]}"[^>]*>`))?.[0]; assert.ok(trigger?.includes('role="combobox"'));
      if (key === "UI font") assert.ok(trigger.includes('disabled=""'), "system override disables custom family");
    }
    assert.equal(markup.includes(translate(locale, "Translucent sidebar")), theme !== "translucent", "no nested light/dark/sidebar selectors in full glass");
    assert.match(markup, /role="slider"/); assert.match(markup, /aria-valuemin="25"/); assert.match(markup, /aria-valuemax="100"/);
    assert.match(markup, /dock-icons\/default.png/); assert.match(markup, /dock-icons\/smoked-glass.png/);
    if (!supported) assert.ok(markup.includes(translate(locale, "Dock customization is unavailable on this host.")));
    assert.doesNotMatch(markup, /Silver|White|Glass \/ transparency effects/);
    const terminal = renderToString(createElement(SettingsPanels, { section: "terminal", settings, host, agents: [], onSave: () => {}, onRefresh: () => {} }));
    assert.ok(terminal.includes(translate(locale, "Terminal font"))); assert.ok(terminal.includes(translate(locale, "Terminal font size")));
  }
  console.log("Appearance SSR:12 locale/support/mode combinations, named Arc controls, slider bounds, system override, Dock assets, single reset and Terminal page passed.");
} finally { await server.close(); }
