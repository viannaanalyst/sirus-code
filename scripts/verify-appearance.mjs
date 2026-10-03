import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { AppearanceSettings } = await server.ssrLoadModule("/src/components/settings/AppearanceSettings.tsx");
  const { mergeSettings } = await server.ssrLoadModule("/src/lib/settings.ts");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const snapshot = useAppStore.getInitialState();
  for (const locale of ["pt-BR", "en"]) for (const theme of ["system", "light", "dark"]) for (const glass of [false, true]) {
    const settings = mergeSettings({ locale, theme, darkWindowTranslucent: glass, lightWindowTranslucent: glass });
    snapshot.settings = settings;
    const html = renderToString(createElement(AppearanceSettings, { settings, host: { appearanceSupport: { translucency: true, dockIcon: true } }, onSave() {} }));
    assert.equal((html.match(/type="radio"/g) ?? []).length, 3);
    assert.ok((html.match(/<input[^>]+type="radio"[^>]*>/g) ?? []).some(input => input.includes(`value="${theme}"`) && input.includes('checked=""')));
    assert.ok(html.includes(locale === "en" ? "System" : "Sistema"));
    assert.ok(html.includes(locale === "en" ? "Light" : "Claro"));
    assert.ok(html.includes(locale === "en" ? "Dark" : "Escuro"));
    assert.equal((html.match(locale === "en" ? /Restore defaults/g : /Restaurar padrões/g) ?? []).length, 1);
    assert.ok(!html.includes(`aria-label="${locale === "en" ? "Theme" : "Tema"}" aria-expanded`));
    assert.equal(html.includes(locale === "en" ? "Apply translucency to" : "Aplicar translucidez em"), glass);
    const unsupported = renderToString(createElement(AppearanceSettings, { settings, host: null, onSave() {} }));
    assert.ok(unsupported.includes(locale === "en" ? "Desktop glass is unavailable" : "indisponível"));
  }
  const css = await readFile(new URL("../src/styles/appearance.css", import.meta.url), "utf8");
  const windowTokens = /html\[data-window-glass="on"\] \{([^}]+)\}/.exec(css)?.[1];
  assert.ok(windowTokens && !/--(?:background-[\w-]+|surface-raised)\s*:/.test(windowTokens), "Glass must not make shared controls transparent");
  assert.ok(css.includes('html[data-popup-glass="on"]') && css.includes("[data-appearance-floating]"));
  console.log("Appearance: native radio cards, checked palette, localized material controls/reset, opaque-host support and popup/control token separation passed");
} finally { await server.close(); }
