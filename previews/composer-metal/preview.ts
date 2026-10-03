import "../../src/styles/index.css";
import "./preview.css";
import { ShaderMount, liquidMetalFragmentShader } from "@paper-design/shaders";
import { composerMetalUniforms, mountComposerMetalBorder, type ComposerMetalMotion } from "../../src/lib/composer-metal";

const paths: Record<string, string> = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  monitor: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5"/>',
  branch: '<path d="M6 3v12a6 6 0 0 0 12 0V9"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  hand: '<path d="M8 12V6a2 2 0 0 1 4 0v5M12 9V4a2 2 0 0 1 4 0v7M16 7a2 2 0 0 1 4 0v9c0 4-3 6-7 6-3 0-5-2-7-5L3 13a2 2 0 0 1 3-2l2 2"/>',
  up: '<path d="m6 11 6-6 6 6M12 5v14"/>',
};
document.querySelectorAll<HTMLElement>("[data-icon]").forEach(node => {
  node.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24">${paths[node.dataset.icon ?? ""] ?? ""}</svg>`;
});
const composer = document.querySelector<HTMLFormElement>("#composer")!;
const prompt = document.querySelector<HTMLTextAreaElement>("#prompt")!;
const send = document.querySelector<HTMLButtonElement>("#send")!;
const pause = document.querySelector<HTMLButtonElement>("#pause")!;
const speeds = document.querySelectorAll<HTMLInputElement>('input[name="speed"]');
const add = document.querySelector<HTMLButtonElement>("#add")!;
const menu = document.querySelector<HTMLElement>("#add-menu")!;
const status = document.querySelector<HTMLElement>("#status")!;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let paused = false;
let inView = true;
let shader: ShaderMount | undefined;
let border: ReturnType<typeof mountComposerMetalBorder> | undefined;
let selectedSpeed: ComposerMetalMotion["speed"] = "slow";
let pointerActive = false;
const syncMotion = () => {
  border?.setMotion({ speed: selectedSpeed, reduced: paused || document.hidden || !inView || reduced.matches });
  composer.querySelector<HTMLElement>(".composer-contour")!.dataset.reduced = String(reduced.matches);
  pause.textContent = reduced.matches ? "Movimento reduzido" : paused ? "Retomar efeito" : "Pausar efeito";
  pause.disabled = reduced.matches;
  pause.setAttribute("aria-pressed", String(paused));
  shader?.setSpeed(!paused && !document.hidden && inView && !reduced.matches && pointerActive ? 1 : 0);
};
const visibility = new IntersectionObserver(entries => { inView = entries[0].isIntersecting; syncMotion(); });
visibility.observe(composer);
pause.addEventListener("click", () => { paused = !paused; syncMotion(); });
speeds.forEach(speed => speed.addEventListener("change", () => {
  if (!speed.checked) return;
  const choice = Number(speed.value);
  selectedSpeed = (["slow", "smooth", "fast"] as const)[choice - 1];
  syncMotion();
}));
prompt.addEventListener("input", () => { send.disabled = !prompt.value.trim(); prompt.style.height = "auto"; prompt.style.height = `${Math.min(prompt.scrollHeight, 200)}px`; });
composer.addEventListener("submit", event => { event.preventDefault(); status.textContent = "Envio simulado · seu texto continua aqui"; });
add.addEventListener("click", () => { menu.hidden = !menu.hidden; add.setAttribute("aria-expanded", String(!menu.hidden)); });
composer.addEventListener("keydown", event => { if (event.key === "Escape") { menu.hidden = true; add.setAttribute("aria-expanded", "false"); add.focus(); } });
document.querySelector("#context")!.addEventListener("click", () => { status.textContent = "Contexto de exemplo selecionado"; menu.hidden = true; add.setAttribute("aria-expanded", "false"); add.focus(); });
document.querySelector("#approval")!.addEventListener("click", event => { const label = (event.currentTarget as HTMLElement).querySelector("span")!; label.textContent = label.textContent === "Solicitar aprovação" ? "Aprovar por mim" : "Solicitar aprovação"; });
document.querySelector("#model")!.addEventListener("click", event => { const label = (event.currentTarget as HTMLElement).querySelector("span")!; label.textContent = label.textContent === "Opus 5" ? "Sonnet 5" : "Opus 5"; });
function mountSurfaces() {
  if (!shader) {
    try {
      shader = new ShaderMount(add.querySelector<HTMLElement>(".composer-metal-surface")!, liquidMetalFragmentShader, composerMetalUniforms(),
        { alpha: false, antialias: false, powerPreference: "low-power" }, 0, 700, 1, 72 * 72);
    } catch { add.querySelector(".composer-metal-surface")!.replaceChildren(); }
  }
  if (!border) {
    const surface = composer.querySelector<HTMLElement>(".composer-contour")!;
    try { border = mountComposerMetalBorder(surface, ShaderMount, liquidMetalFragmentShader, { speed: selectedSpeed, reduced: reduced.matches }); }
    catch { surface.replaceChildren(); }
  }
  syncMotion();
}
mountSurfaces();
add.addEventListener("pointerenter", () => { pointerActive = true; syncMotion(); });
add.addEventListener("pointerleave", () => { pointerActive = add.matches(":focus-visible"); syncMotion(); });
add.addEventListener("focus", () => { pointerActive = add.matches(":focus-visible"); syncMotion(); });
add.addEventListener("blur", () => { pointerActive = false; syncMotion(); });
document.addEventListener("visibilitychange", syncMotion);
reduced.addEventListener("change", syncMotion);
window.addEventListener("pagehide", () => { visibility.disconnect(); shader?.dispose(); shader = undefined; border?.dispose(); border = undefined; });
window.addEventListener("pageshow", () => { visibility.observe(composer); mountSurfaces(); });
syncMotion();
