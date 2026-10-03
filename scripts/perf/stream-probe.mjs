// Streaming cost: ~100 agent-output deltas per second (with a code block) into a live message.
/* global window, document, setInterval, clearInterval */ // Browser-side callbacks run inside the page.
// Requires Playwright (not a project dependency) and `npx vite --port 5199` running.
// PLAYWRIGHT_MODULE may point at an installed playwright/index.mjs.
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const demoIpc = fileURLToPath(new URL("../../marketing/video/demo-ipc.js", import.meta.url));
const browser = await chromium.launch();
async function probe(label, count) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript({ path: demoIpc });
  await page.addInitScript((count) => {
    if (window === window.top) return;
    window.__outputHandlers = [];
    const code = "```ts\nexport function rateLimit(windowMs = 60_000, max = 5) {\n  const hits = new Map<string, number[]>();\n  return (req: Request, res: Response, next: () => void) => {\n    const now = Date.now();\n    if (hits.size > max) return res.status(429).end();\n    next();\n  };\n}\n```";
    const wait = setInterval(() => {
      const i = window.__TAURI_INTERNALS__; if (!i || i.__wrapped) return;
      const orig = i.invoke;
      i.invoke = async (c, a) => {
        const r = await orig(c, a);
        if (c === "plugin:event|listen" && a.event === "agent-output") window.__outputHandlers.push(a.handler);
        if (c === "load_state") {
          const s = r.sessions.find(x => x.id === "darkmode");
          s.messages = Array.from({ length: count }, (_, n) => ({ id: `big${n}`, sessionId: "darkmode", role: n % 2 ? "agent" : "user", content: n % 2 ? `Resposta ${n} com explicação.\n\n${code}\n\nMais texto.` : `Pergunta ${n}`, createdAt: new Date(Date.now() - 1e6 + n * 1000).toISOString(), streaming: false }));
          s.messages.push({ id: "ask", sessionId: "darkmode", role: "user", content: "continue", createdAt: new Date().toISOString(), streaming: false });
          s.messages.push({ id: "live", sessionId: "darkmode", role: "agent", content: "", createdAt: new Date().toISOString(), streaming: true });
          s.status = "running";
        }
        return r;
      };
      i.__wrapped = true; clearInterval(wait);
    }, 0);
    window.__startStream = () => {
      const text = ("Analisando o middleware de autenticação e o fluxo de login. " .repeat(6)) + "\n\n" + code + "\n\n" + ("Depois ajusto os testes e confirmo o comportamento com 429. ".repeat(40));
      let offset = 0, position = 0;
      const timer = setInterval(() => {
        const chunk = text.slice(position, position + 6) || " ok";
        position += 6;
        const payload = { sessionId: "darkmode", messageId: "live", offset, chunk, stream: "stdout", message: null };
        offset += chunk.length;
        for (const handler of window.__outputHandlers) window[`_${handler}`]?.({ event: "agent-output", id: handler, payload });
      }, 10);
      setTimeout(() => clearInterval(timer), 10500);
    };
  }, count);
  await page.goto("http://localhost:5199/marketing/video/stage.html");
  await page.evaluate(() => { window.studio.load("/?demo&lang=pt"); window.studio.showWindow(10); });
  const f = () => page.frames().find(x => x.url().includes("demo"));
  for (let i = 0; i < 100 && !f(); i++) await page.waitForTimeout(100);
  await f().waitForSelector("[data-draft-owner]", { timeout: 45000 });
  await f().locator("text=Refinar o modo escuro").first().click();
  await page.waitForTimeout(2500);
  await f().locator("[data-draft-owner]").first().click(); // shader off: measure streaming only
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const m0 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
  await f().evaluate(() => window.__startStream());
  await page.waitForTimeout(10000);
  const m1 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
  const length = await f().evaluate(() => document.querySelector('[data-message-id="live"]')?.textContent.length ?? -1);
  console.log(`== ${label}: task ${((m1.TaskDuration - m0.TaskDuration) * 10).toFixed(1)}% of a core · script ${((m1.ScriptDuration - m0.ScriptDuration) * 100).toFixed(0)} ms/s · style ${((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 100).toFixed(0)} ms/s · layout ${((m1.LayoutDuration - m0.LayoutDuration) * 100).toFixed(0)} ms/s · heap ${(m1.JSHeapUsedSize / 1048576).toFixed(0)} MB · rendered ${length} chars`);
  await page.close();
}
await probe("6 messages", 6);
await probe("300 messages with code", 300);
await browser.close();
