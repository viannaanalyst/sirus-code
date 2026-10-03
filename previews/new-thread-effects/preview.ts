import "../../src/styles/index.css";
import "./preview.css";
import { ShaderMount, liquidMetalFragmentShader } from "@paper-design/shaders";
import { composerMetalUniforms, mountComposerMetalBorder } from "../../src/lib/composer-metal";
import { motionTokens } from "../../src/lib/motion";
import { drawEffect, type Effect } from "./effects";

const icons: Record<string, string> = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  monitor: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5"/>',
  branch: '<path d="M6 3v12a6 6 0 0 0 12 0V9"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  hand: '<path d="M8 12V6a2 2 0 0 1 4 0v5M12 9V4a2 2 0 0 1 4 0v7M16 7a2 2 0 0 1 4 0v9c0 4-3 6-7 6-3 0-5-2-7-5L3 13a2 2 0 0 1 3-2l2 2"/>',
  up: '<path d="m6 11 6-6 6 6M12 5v14"/>', pause: '<path d="M9 5v14M15 5v14"/>',
  session: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h4"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>',
  dock: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
};
document.querySelectorAll<HTMLElement>("[data-icon]").forEach(node => {
  node.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24">${icons[node.dataset.icon ?? ""] ?? ""}</svg>`;
});
function get<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing preview element: ${selector}`);
  return node;
}
const landing = get<HTMLElement>(".landing");
const canvas = get<HTMLCanvasElement>("#effect-canvas");
const ctx = canvas.getContext("2d");
const prompt = get<HTMLTextAreaElement>("#prompt");
const composer = get<HTMLFormElement>("#composer");
const add = get<HTMLButtonElement>("#add");
const pause = get<HTMLButtonElement>("#pause");
const speed = get<HTMLButtonElement>("#speed");
const intensity = get<HTMLInputElement>("#intensity");
const send = get<HTMLButtonElement>("#send");
const menu = get<HTMLElement>("#add-menu");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const choices: Effect[] = ["mare", "veu", "orbitas"];
const descriptions: Record<Effect, string> = {
  mare: "Linhas fluidas, pontos de luz e reflexos que percorrem a paisagem.",
  veu: "Camadas de luz prateada, com dobras suaves e movimento de seda.",
  orbitas: "Arcos delicados e pontos de luz em órbita. O centro fica livre.",
};
const initial = new URLSearchParams(location.search).get("effect") ?? document.body.dataset.effect;
let effect: Effect = choices.includes(initial as Effect) ? initial as Effect : "mare";
let paused = false;
let editing = false;
let visible = true;
let alive = true;
let pointerActive = false;
let speedIndex = 2;
let width = 1, height = 1;
let time = 5;
let raf: number | undefined;
let last: number | undefined;
let lastDraw = 0;
let shader: ShaderMount | undefined;
let border: ReturnType<typeof mountComposerMetalBorder> | undefined;
const speeds = [.4, .7, 1];
const speedLabels = ["Lenta", "Suave", "Rápida"];
const frameInterval = motionTokens.normal * 1000 / 6;
const shouldAnimate = () => alive && !paused && !editing && visible && !document.hidden && !reduced.matches;
const render = () => { if (ctx) drawEffect(ctx, effect, width, height, time, Number(intensity.value) / 100); };

function tick(now: number) {
  raf = undefined;
  if (!shouldAnimate()) return;
  if (last !== undefined) time += Math.min(now - last, 80) / 1000 * speeds[speedIndex];
  last = now;
  if (now - lastDraw >= frameInterval) { lastDraw = now; render(); }
  raf = requestAnimationFrame(tick);
}
function syncMotion() {
  const stopped = !shouldAnimate();
  if (stopped) {
    if (raf !== undefined) cancelAnimationFrame(raf);
    raf = undefined; last = undefined;
  } else if (raf === undefined) { last = undefined; raf = requestAnimationFrame(tick); }
  border?.setMotion({ speed: "slow", reduced: !alive || paused || !visible || document.hidden || reduced.matches });
  shader?.setSpeed(alive && !paused && visible && !document.hidden && !reduced.matches && pointerActive ? 1 : 0);
  get<HTMLElement>(".composer-contour").dataset.reduced = String(reduced.matches);
  pause.querySelector("span")!.textContent = reduced.matches ? "Sem movimento" : paused ? "Retomar" : "Pausar";
  pause.disabled = reduced.matches;
  pause.setAttribute("aria-pressed", String(paused));
}
function selectEffect(next: Effect, updateUrl = true) {
  effect = next;
  document.body.dataset.effect = next;
  document.querySelectorAll<HTMLButtonElement>("button[data-effect]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.effect === effect)));
  get<HTMLElement>("#effect-number").textContent = `0${choices.indexOf(effect) + 1} / 03`;
  get<HTMLElement>("#effect-description").textContent = descriptions[effect];
  document.title = `Switchyard · ${["Maré de prata", "Véu de luz", "Órbitas"][choices.indexOf(effect)]}`;
  if (updateUrl) { const url = new URL(location.href); url.searchParams.set("effect", effect); history.replaceState(null, "", url); }
  render();
}
document.querySelectorAll<HTMLButtonElement>("button[data-effect]").forEach(button => button.addEventListener("click", () => selectEffect(button.dataset.effect as Effect)));
get<HTMLElement>(".effect-picker").addEventListener("keydown", event => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const index = event.key === "Home" ? 0 : event.key === "End" ? 2 : (choices.indexOf(effect) + (event.key === "ArrowRight" ? 1 : 2)) % 3;
  selectEffect(choices[index]); get<HTMLButtonElement>(`button[data-effect="${effect}"]`).focus();
});
pause.addEventListener("click", () => { paused = !paused; syncMotion(); });
speed.addEventListener("click", () => {
  speedIndex = (speedIndex + 1) % 3;
  speed.firstChild!.textContent = `${speedLabels[speedIndex]} `;
  speed.setAttribute("aria-label", `Velocidade do fundo: ${speedLabels[speedIndex].toLowerCase()}`);
});
intensity.addEventListener("input", () => { get<HTMLOutputElement>("#intensity-value").value = `${intensity.value}%`; render(); });
prompt.addEventListener("focus", () => { editing = true; syncMotion(); });
prompt.addEventListener("blur", () => { editing = false; syncMotion(); });
prompt.addEventListener("input", () => {
  send.disabled = !prompt.value.trim(); prompt.style.height = "auto";
  prompt.style.height = `${Math.min(prompt.scrollHeight, 160)}px`;
});
composer.addEventListener("submit", event => { event.preventDefault(); get<HTMLElement>("#status").textContent = "Envio simulado. Seu texto continua aqui."; });
add.addEventListener("click", () => { menu.hidden = !menu.hidden; add.setAttribute("aria-expanded", String(!menu.hidden)); });
composer.addEventListener("keydown", event => { if (event.key === "Escape") { menu.hidden = true; add.setAttribute("aria-expanded", "false"); add.focus(); } });
get<HTMLButtonElement>("#context").addEventListener("click", () => { get<HTMLElement>("#status").textContent = "Pasta de exemplo selecionada."; menu.hidden = true; add.setAttribute("aria-expanded", "false"); add.focus(); });
get<HTMLButtonElement>("#approval").addEventListener("click", event => { const label = (event.currentTarget as HTMLElement).querySelector("span")!; label.textContent = label.textContent === "Solicitar aprovação" ? "Aprovar por mim" : "Solicitar aprovação"; });
get<HTMLButtonElement>("#model").addEventListener("click", event => { const label = (event.currentTarget as HTMLElement).querySelector("span")!; label.textContent = label.textContent === "DeepSeek V4.1 Flash" ? "DeepSeek V4.1" : "DeepSeek V4.1 Flash"; });

const resize = new ResizeObserver(([entry]) => {
  width = Math.max(1, entry.contentRect.width); height = Math.max(1, entry.contentRect.height);
  const ratio = Math.min(devicePixelRatio, 1.5, Math.sqrt(900_000 / (width * height)));
  canvas.width = Math.max(1, Math.floor(width * ratio)); canvas.height = Math.max(1, Math.floor(height * ratio));
  ctx?.setTransform(ratio, 0, 0, ratio, 0, 0); render();
});
const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; syncMotion(); });
function mount() {
  alive = true; resize.observe(landing); observer.observe(landing);
  if (!shader) {
    const surface = get<HTMLElement>(".composer-metal-surface");
    try { shader = new ShaderMount(surface, liquidMetalFragmentShader, composerMetalUniforms(), { alpha: false, antialias: false, powerPreference: "low-power" }, 0, 700, 1, 72 * 72); }
    catch { surface.replaceChildren(); }
  }
  if (!border) {
    const surface = get<HTMLElement>(".composer-contour");
    try { border = mountComposerMetalBorder(surface, ShaderMount, liquidMetalFragmentShader, { speed: "slow", reduced: reduced.matches }); }
    catch { surface.replaceChildren(); }
  }
  syncMotion();
}
add.addEventListener("pointerenter", () => { pointerActive = true; syncMotion(); });
add.addEventListener("pointerleave", () => { pointerActive = add.matches(":focus-visible"); syncMotion(); });
add.addEventListener("focus", () => { pointerActive = add.matches(":focus-visible"); syncMotion(); });
add.addEventListener("blur", () => { pointerActive = false; syncMotion(); });
document.addEventListener("visibilitychange", syncMotion);
reduced.addEventListener("change", syncMotion);
window.addEventListener("pagehide", () => {
  alive = false; syncMotion(); resize.disconnect(); observer.disconnect();
  shader?.dispose(); shader = undefined; border?.dispose(); border = undefined;
});
window.addEventListener("pageshow", mount);
selectEffect(effect, false); mount();
