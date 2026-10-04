// Sidebar cost with many sessions: DOM nodes, rendered rows and JS heap.
// Requires Playwright (not a project dependency) and `npx vite --port 5199` running.
/* global window, document */ // Browser-side callbacks run inside the page.
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const demoIpc = fileURLToPath(new URL("../../marketing/video/demo-ipc.js", import.meta.url));
const browser = await chromium.launch();
async function probe(label, count, scroll) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript({ path: demoIpc });
  await page.addInitScript((count) => {
    if (window === window.top) return;
    const base = window.__demoSessions[0];
    for (let n = 0; n < count; n++) window.__demoSessions.push({ ...base, id: `heavy${n}`, title: `Heavy ${n}`, status: "completed", messages: [] });
  }, count);
  await page.goto("http://localhost:5199/marketing/video/stage.html");
  await page.evaluate(() => { window.studio.load("/?demo&lang=pt"); window.studio.showWindow(10); });
  const frame = () => page.frames().find(x => x.url().includes("demo"));
  for (let i = 0; i < 100 && !frame(); i++) await page.waitForTimeout(100);
  const f = frame();
  await f.waitForSelector("[data-draft-owner]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  if (scroll) {
    await f.evaluate(() => { const list = document.querySelector(".sidebar-project-list"); list.scrollTop = list.scrollHeight / 2; });
    await page.waitForTimeout(600);
  }
  const info = await f.evaluate(() => ({
    nodes: document.querySelectorAll("*").length,
    rows: document.querySelectorAll(".sidebar-session-row").length,
    visible: [...document.querySelectorAll(".sidebar-session-row .sidebar-row-title")].filter(node => { const r = node.getBoundingClientRect(); const v = document.querySelector(".sidebar-project-list").getBoundingClientRect(); return r.bottom > v.top && r.top < v.bottom; }).map(node => node.textContent).slice(0, 3),
    scrollHeight: document.querySelector(".sidebar-project-list").scrollHeight,
  }));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const heap = await cdp.send("Runtime.getHeapUsage", {});
  console.log(`== ${label}: DOM nodes ${info.nodes} · session rows ${info.rows} · JS heap ${Math.round(heap.usedSize / 1048576)} MB · list height ${info.scrollHeight}px · first visible ${JSON.stringify(info.visible)}`);
  await page.close();
}
await probe("5 sessions", 0, false);
await probe("305 sessions", 300, false);
await probe("305 sessions, scrolled to the middle", 300, true);
await browser.close();
