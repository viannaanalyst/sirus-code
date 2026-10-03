// Idle cost per screen: CDP task time plus requestAnimationFrame/timer counts by source.
/* global window, document, Event */ // Browser-side callbacks run inside the page.
// Requires Playwright (not a project dependency) and `npx vite --port 5199` running.
// PLAYWRIGHT_MODULE may point at an installed playwright/index.mjs.
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const demoIpc = fileURLToPath(new URL("../../marketing/video/demo-ipc.js", import.meta.url));
const browser = await chromium.launch();
async function probe(label, setup) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript({ path: demoIpc });
  await page.addInitScript(() => {
    // Count frame callbacks and timers by their source line, to find loops that run while idle.
    window.__raf = 0; window.__timers = 0; window.__rafSources = {};
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => { window.__raf++; const src = (new Error().stack || "").split("\n")[2]?.trim() ?? "?"; window.__rafSources[src] = (window.__rafSources[src] || 0) + 1; return raf(cb); };
    const st = window.setTimeout.bind(window); window.setTimeout = (cb, ms, ...a) => { window.__timers++; return st(cb, ms, ...a); };
    const si = window.setInterval.bind(window); window.__intervals = []; window.setInterval = (cb, ms, ...a) => { window.__intervals.push(ms); return si(cb, ms, ...a); };
  });
  await page.goto("http://localhost:5199/?demo&lang=pt");
  // demo-ipc only activates inside an iframe; use the stage instead.
  await page.goto("http://localhost:5199/marketing/video/stage.html");
  await page.evaluate(() => { window.studio.load("/?demo&lang=pt"); window.studio.showWindow(10); });
  const f = () => page.frames().find(x => x.url().includes("demo"));
  for (let i = 0; i < 100 && !f(); i++) await page.waitForTimeout(100);
  await f().waitForSelector("[data-draft-owner]", { timeout: 45000 });
  if (setup) await setup(f(), page);
  console.log("  focused:", await f().evaluate(() => document.hasFocus()));
  await page.waitForTimeout(3000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const m0 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
  const r0 = await f().evaluate(() => ({ raf: window.__raf, timers: window.__timers }));
  await page.waitForTimeout(10000);
  const m1 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
  const r1 = await f().evaluate(() => ({ raf: window.__raf, timers: window.__timers, intervals: window.__intervals, sources: Object.entries(window.__rafSources).sort((a, b) => b[1] - a[1]).slice(0, 4) }));
  console.log(`\n== ${label}\n  task time ${((m1.TaskDuration - m0.TaskDuration) * 100 / 10).toFixed(2)}% of a core · script ${((m1.ScriptDuration - m0.ScriptDuration) * 1000 / 10).toFixed(1)} ms/s · layout ${((m1.LayoutDuration - m0.LayoutDuration) * 1000 / 10).toFixed(1)} ms/s · style ${((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000 / 10).toFixed(1)} ms/s`);
  console.log(`  rAF/s ${((r1.raf - r0.raf) / 10).toFixed(1)} · setTimeout/s ${((r1.timers - r0.timers) / 10).toFixed(1)} · intervals ${JSON.stringify(r1.intervals)}`);
  for (const [src, n] of r1.sources) console.log(`    ${n}× ${src.replace(/http:\/\/localhost:5199/, "").slice(0, 120)}`);
  await page.close();
}
await probe("landing (empty new thread)", async (f) => { await f.evaluate(() => window.focus()); });
await probe("session view (completed session)", async (f) => { await f.locator("text=Refinar o modo escuro").first().click(); });
await probe("session view, composer focused", async (f) => { await f.locator("text=Refinar o modo escuro").first().click(); await f.locator("[data-draft-owner]").first().click(); });
await probe("settings open", async (f) => { await f.evaluate(() => window.focus()); await f.locator('.sidebar-rail-button[data-section="settings"]').click(); });
await probe("session view, window blurred", async (f) => { await f.locator("text=Refinar o modo escuro").first().click(); await f.evaluate(() => window.dispatchEvent(new Event("blur"))); });
await browser.close();
