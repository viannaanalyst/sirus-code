// Real Appearance renders; no native IPC, providers or browser launch.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { AppearanceSettings } = await server.ssrLoadModule("/src/components/settings/AppearanceSettings.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const { mergeSettings } = await server.ssrLoadModule("/src/lib/settings.ts");
  const { translate } = await server.ssrLoadModule("/src/i18n/index.ts");
  const snapshot = useAppStore.getInitialState();
  for (const locale of ["pt-BR", "en"]) {
    for (const dockIcon of ["default", "smokedGlass", "white"]) {
      const settings = mergeSettings({ locale, dockIcon });
      Object.assign(snapshot, { settings });
      useAppStore.setState({ settings });
      const render = host => renderToString(createElement(AppearanceSettings, { settings, host, onSave: () => {} }));
      const host = { appearanceSupport: { translucency: true, dockIcon: true } };
      const getPicker = markup => markup.match(/<div class="appearance-dock-options"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
      const picker = getPicker(render(host));
      const options = [...picker.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)];
      assert.equal(options.length, 3, "all three choices are available");
      assert.equal(options.filter(([, attrs]) => attrs.includes('aria-pressed="true"')).length, 1);
      for (const [index, label] of ["Default", "Smoked glass", "White"].entries()) {
        const [, attrs, content] = options[index];
        assert.ok(attrs.includes(`aria-label="${translate(locale, label)}"`), "icon-only choices have localized accessible names");
        assert.doesNotMatch(content, /<span|<p|role="tooltip"/, "no visible captions or tooltips");
        const file = ["default", "smoked-glass", "white"][index];
        assert.ok(content.includes(`/dock-icons/${file}.png`));
        assert.equal(attrs.includes('aria-pressed="true"'), dockIcon === ["default", "smokedGlass", "white"][index]);
        assert.ok(!attrs.includes('disabled=""'));
      }
      assert.equal([...getPicker(render(null)).matchAll(/<button[^>]*disabled=""/g)].length, 3, "unsupported hosts cannot request native icon changes");
    }
  }
  console.log("Three compact Dock choices, localized accessible names, selection and unsupported-host renders passed");
} finally {
  await server.close();
}
