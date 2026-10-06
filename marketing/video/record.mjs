// Records the product demo: the real Sirus Code UI (demo IPC) inside stage.html, with a scripted
// camera, cursor and captions. Frames come from Chromium's screencast at 1080p and ffmpeg builds the MP4.
// Usage: node marketing/video/record.mjs [en|pt] [output.mp4]   (needs `npx vite --port 5199` running)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = await import(PLAYWRIGHT);
const lang = process.argv[2] === "pt" ? "pt" : "en";
const output = process.argv[3] ?? join(process.env.HOME, "Downloads", `sirus-demo-${lang}.mp4`);
const BASE = process.env.STUDIO_BASE ?? "http://localhost:5199";
const here = new URL(".", import.meta.url).pathname;
const pt = lang === "pt";
const T = {
  tagline: pt ? "Seu desenvolvimento, em órbita." : "Your development, in orbit.",
  intro: pt ? "Todos os seus agentes de código. <b>Um só lugar.</b>" : "Every coding agent. <b>One workspace.</b>",
  describe: pt ? "Descreva a tarefa — o agente cuida do resto" : "Describe the task — the agent takes it from there",
  prompt: pt ? "Limite as tentativas de login na API e cubra com testes" : "Rate-limit the login API and cover it with tests",
  steps: pt ? "Acompanhe cada passo: <b>leituras, edições, subagentes, testes</b>" : "Follow every step: <b>reads, edits, subagents, tests</b>",
  review: pt ? "Revise o que mudou — e <b>mantenha</b>" : "Review what changed — then <b>keep it</b>",
  parallel: pt ? "Sessões em <b>paralelo</b>, cada uma no seu ritmo" : "Sessions running <b>in parallel</b>",
  details: pt ? "Cuidado em <b>cada detalhe</b>" : "Crafted down to <b>every detail</b>",
  end: pt ? "Grátis e open source · macOS" : "Free and open source · macOS",
};

const frames = mkdtempSync(join(tmpdir(), "sirus-frames-"));
const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--disable-features=CalculateNativeWinOcclusion"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.addInitScript({ path: join(here, "demo-ipc.js") });
await page.goto(`${BASE}/marketing/video/stage.html`);
await page.waitForTimeout(400);

/* ---------- capture ---------- */
const cdp = await page.context().newCDPSession(page);
const shots = [];
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  const file = join(frames, `f${String(shots.length).padStart(6, "0")}.jpg`);
  writeFileSync(file, Buffer.from(data, "base64"));
  shots.push({ file, t: metadata.timestamp });
  void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});

/* ---------- helpers ---------- */
const studio = (fn, ...args) => page.evaluate(([name, params]) => window.studio[name](...params), [fn, args]);
const wait = (ms) => page.waitForTimeout(ms);
const app = () => page.frames().find((frame) => frame.url().includes("demo"));
/** Window-space center of an app element (for the camera). */
const at = async (selector, dy = 0) => (await app().waitForSelector(selector, { timeout: 20000 })).evaluate((el, dy) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 + dy, w: r.width, h: r.height }; }, dy);
/** Moves the stage cursor onto an element and clicks it through the real UI. */
async function click(locator, ms = 750) {
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await studio("cursorTo", x, y, ms);
  await studio("ripple");
  await page.mouse.click(x, y);
}

/* ---------- script ---------- */
// The app boots off camera, so the window opens on a ready UI.
await studio("load", `${BASE}/?demo&lang=${lang}`);
await page.waitForFunction(() => { const f = document.getElementById("app"); return f.contentDocument && !f.contentDocument.getElementById("app-splash") && f.contentDocument.querySelector("[data-draft-owner]"); }, null, { timeout: 45000, polling: 250 });
await wait(600);
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
await studio("card", `<div><img src="/sirus-glyph.png" alt=""><h1>Sirus Code</h1><p>${T.tagline}</p></div>`);
await wait(2600);
await studio("hideCard");
await studio("showWindow");
await studio("caption", T.intro);
await wait(1600);

const frame = app();
// Open a fresh thread from the sidebar.
await click(frame.locator("[data-new-session]"));
await wait(500);
const composer = await at("[data-draft-owner]");
await studio("caption", T.describe);
await studio("camera", composer.x, composer.y - 120, 1.55, 1200);
await click(frame.locator("[data-draft-owner]").first(), 500);
await page.keyboard.type(T.prompt, { delay: 30 });
await wait(350);
await page.keyboard.press("Enter");
await studio("hideCursor");
await wait(700);

// The trail fills in live under the request.
await studio("caption", T.steps);
const request = await at('[data-message-id="u-new"]');
const top = request.y - request.h / 2;
await studio("camera", 720, top + 230, 1.55, 1200);
await wait(6200);
// The answer streams, then the change summary lands.
await studio("caption", T.review);
await page.waitForFunction(() => document.getElementById("app").contentDocument.querySelector("article section.rounded-xl"), null, { timeout: 8000 }).catch(() => {});
const summary = await at("article section.rounded-xl").catch(() => request);
await studio("camera", 720, summary.y - 40, 1.45, 1300);
await wait(2300);

// Parallel sessions: collapse the sidebar so the header tabs take over.
await studio("caption", T.parallel);
await studio("reset", 1000);
await frame.locator("body").press("Meta+b");
await wait(700);
await studio("camera", 600, 250, 1.7, 1200);
await wait(900);
await click(frame.locator('[data-tab="checkout"]'), 650);
await wait(1300);
await click(frame.locator('[data-tab="billing"]'), 650);
await wait(1200);

// Details: Settings revealed from the gear, directional menus.
await studio("caption", T.details);
await studio("reset", 1000);
// Dock the sidebar again (spring open, rows cascade) so Settings shows its menu.
await frame.locator("body").press("Meta+b");
await wait(900);
await click(frame.locator('.sidebar-rail-button[data-section="settings"]'), 650);
await wait(1100);
await click(frame.locator(".settings-nav button").filter({ hasText: pt ? /^Aparência$/ : /^Appearance$/ }), 600);
await wait(1100);
await click(frame.locator(".settings-nav button").filter({ hasText: pt ? /^Atalhos$/ : /^Keybindings$/ }), 600);
await wait(1300);
await studio("hideCursor");
await frame.locator("body").press("Escape");
await wait(900);

// End card.
await studio("caption", "");
await studio("dimWindow", true, 800);
await studio("card", `<div><img src="/sirus-glyph.png" alt=""><h1>${T.tagline}</h1><p>${T.end}</p><div class="chips"><span>Codex</span><span>Claude Code</span><span>OpenCode</span><span>Cursor</span><span>+5 CLIs</span></div></div>`);
await wait(3000);

await cdp.send("Page.stopScreencast");
await browser.close();

/* ---------- encode ---------- */
const list = shots.map((shot, index) => {
  const next = shots[index + 1]?.t ?? shot.t + 0.5;
  return `file '${shot.file}'\nduration ${Math.max(0.001, next - shot.t).toFixed(4)}`;
}).join("\n") + `\nfile '${shots.at(-1).file}'\n`;
writeFileSync(join(frames, "list.txt"), list);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(frames, "list.txt"),
  "-vf", "fps=60,scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-movflags", "+faststart", output], { stdio: "inherit" });
console.log(`${shots.length} frames → ${output}`);
rmSync(frames, { recursive: true, force: true });
