import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

// Render the real controls with native catalog fixtures, without UI automation.
const server = await createServer({
  server: { middlewareMode: true, hmr: false }, appType: "custom",
  plugins: [{ name: "skills-fixture", enforce: "pre", transform(source, id) {
    if (!id.endsWith("/src/lib/use-skills-catalog.ts")) return;
    assert.ok(source.includes("export function useSkillsCatalog(owner:"));
    return `let fixture; export function setFixture(next) { fixture = next; }
      export function useSkillsCatalog() { return { ...fixture, key: "fixture", refresh: async () => {} }; }`;
  } }],
});
try {
  const { SkillsSettings } = await server.ssrLoadModule("/src/components/settings/SkillsSettings.tsx");
  const { ComposerSkillPicker } = await server.ssrLoadModule("/src/components/ComposerSkillPicker.tsx");
  const { setFixture } = await server.ssrLoadModule("/src/lib/use-skills-catalog.ts");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const snapshot = useAppStore.getInitialState();
  const source = (id, origin) => ({ id, origin, scope: "user", path: `/fixture/${origin}/review/SKILL.md` });
  const catalog = { portableDir: "/fixture/skills", truncated: false, skills: [
    { name: "review", description: "<script>unsafe()</script>", sources: [source("a", "codex"), source("b", "claude")] },
    { name: "disabled", description: "Hidden from the picker", sources: [source("c", "agents")] },
  ] };
  for (const locale of ["pt-BR", "en"]) {
    for (const mode of ["dark", "light", "translucent"]) {
      snapshot.settings = { ...snapshot.settings, locale, appearance: { ...snapshot.settings.appearance, mode }, disabledSkills: ["disabled"] };
      setFixture({ catalog, loading: false, error: null });
      const html = renderToString(createElement(SkillsSettings, { settings: snapshot.settings }));
      assert.equal((html.match(/role="switch"/g) ?? []).length, 2);
      assert.ok(html.includes('aria-checked="true"') && html.includes('aria-checked="false"'));
      assert.equal((html.match(locale === "en" ? /Restore defaults/g : /Restaurar padrões/g) ?? []).length, 1);
      assert.ok(html.includes("&lt;script&gt;unsafe()&lt;/script&gt;"));
      assert.ok(html.includes("/fixture/codex/review/SKILL.md") && html.includes("/fixture/claude/review/SKILL.md"));
      assert.ok(html.includes(locale === "en" ? "1 of 2 skills enabled" : "1 de 2 skills ativas"));
      assert.ok(html.includes(locale === "en" ? "Across all sources" : "Em todas as origens"));
      assert.ok(html.includes(locale === "en" ? "Found in" : "Encontrada em"));
      const picker = renderToString(createElement(ComposerSkillPicker, { owner: "project:fixture", onSelect() {} }));
      assert.ok(picker.includes("review") && !picker.includes("Hidden from the picker"));
      const blocked = renderToString(createElement(ComposerSkillPicker, { owner: "project:fixture", unavailable: true, onSelect() {} }));
      assert.ok(blocked.includes('type="button" disabled=""'));
    }
    for (const fixture of [{ catalog: null, loading: true, error: null }, { catalog: null, loading: false, error: "Fixture failed" }, { catalog: { ...catalog, skills: [] }, loading: false, error: null }]) {
      setFixture(fixture);
      const html = renderToString(createElement(SkillsSettings, { settings: snapshot.settings }));
      assert.ok(html.includes('role="status"') || html.includes('role="alert"') || html.includes(locale === "en" ? "No skills found" : "Nenhuma skill encontrada"));
    }
  }
  console.log("Agent skills: settings/picker render fixtures in both locales/all modes; escaping, source metadata, compact switches, reset and disabled selection passed");
} finally { await server.close(); }
