import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { AstroFloatRail } = await server.ssrLoadModule("/src/components/astros/AstroFloatRail.tsx");
  const { useAppStore } = await server.ssrLoadModule("/src/store/app-store.ts");
  const snapshot = useAppStore.getInitialState();
  const astro = (id, name, color, unread = 0) => ({ id, name, icon: "planeta", style: "metal", color, background: "liso", projectIds: [], soul: "", sessionId: null, createdAt: "time", memory: [], unread, approval: "auto", hideSessions: false });
  const astros = [astro("nova", "Nova", "#8c9bff"), astro("vega", "Vega", "#d97757", 2), astro("lyra", "<b>Lyra</b>", "#74aa9c")];
  for (const [locale, rail, add] of [["en", "Astros", "New Astro"], ["pt-BR", "Astros", "Novo Astro"]]) {
    snapshot.settings = { ...snapshot.settings, locale };
    for (const focused of [true, false]) {
      const html = renderToString(createElement(AstroFloatRail, { astros, currentId: "vega", focused, onSelect() {}, onCreate() {} }));
      assert.ok(html.includes(`aria-label="${rail}"`) && html.includes(`data-focused="${focused}"`), "the rail is a labelled nav that dims in the background");
      assert.equal((html.match(/class="astro-float-rail-astro"/g) ?? []).length, 3, "every Astro has a button");
      assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
      assert.ok(/aria-label="Vega" aria-current="page"/.test(html), "the current Astro is marked");
      assert.ok(!html.includes("astro-float-rail-dot"), "the current Astro shows no unread dot");
      assert.ok(html.includes("--astro:#d97757"), "buttons carry the Astro colour");
      assert.ok(html.includes(`aria-label="${add}"`), "New Astro closes the rail");
      assert.ok(!html.includes("<b>Lyra</b>") && html.includes("&lt;b&gt;Lyra&lt;/b&gt;"), "names are escaped");
      assert.ok(!/uppercase/.test(html));
    }
    const unread = renderToString(createElement(AstroFloatRail, { astros, currentId: "nova", focused: true, overlay: true, onSelect() {}, onCreate() {} }));
    assert.ok(unread.includes("astro-float-rail-dot") && unread.includes("astro-float-rail-overlay"), "unread Astros show a dot; the narrow sheet is marked");
  }
  console.log("Astro float rail: every Astro with its colour, one current, unread dots, New Astro and focus dimming, labelled in both locales");
} finally { await server.close(); }
