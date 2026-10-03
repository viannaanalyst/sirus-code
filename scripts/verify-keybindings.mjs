import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { KeybindingsSettings } = await server.ssrLoadModule("/src/components/settings/KeybindingsSettings.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const { KEYBINDINGS } = await server.ssrLoadModule("/src/lib/keybindings.ts");
  const snapshot = useAppStore.getInitialState();
  for (const locale of ["pt-BR", "en"]) {
    for (const customShortcuts of [{}, { forward: "meta+shift+]", "open-browser": "meta+shift+b" }]) {
      snapshot.settings = { ...snapshot.settings, locale, customShortcuts };
      const html = renderToString(createElement(KeybindingsSettings, { settings: snapshot.settings }));
      assert.ok(html.includes('type="search"'));
      assert.equal((html.match(/data-keybinding-row=/g) ?? []).length, KEYBINDINGS.length);
      assert.equal((html.match(locale === "en" ? />Edit</g : />Editar</g) ?? []).length, KEYBINDINGS.length, "every command has an Edit action");
      assert.ok(html.includes(locale === "en" ? ">Command<" : ">Comando<") && html.includes(locale === "en" ? ">Keybinding<" : ">Atalho<"));
      assert.equal((html.match(locale === "en" ? /Restore defaults/g : /Restaurar padrões/g) ?? []).length, 1);
      assert.ok(!html.includes('aria-label="Reset to ') && !html.includes('aria-label="Restaurar para '));
      assert.ok(html.includes(locale === "en" ? "Open Browser" : "Abrir Navegador"));
      assert.ok(html.includes(locale === "en" ? `${KEYBINDINGS.length} of ${KEYBINDINGS.length} commands` : `${KEYBINDINGS.length} de ${KEYBINDINGS.length} comandos`));
      assert.equal((html.match(locale === "en" ? /Customized/g : /Personalizado/g) ?? []).length, Object.keys(customShortcuts).length);
    }
  }
  console.log("Keybindings: command table, Edit actions, grouped commands/custom states, accessible search and one page-wide reset passed in both locales");
} finally { await server.close(); }
