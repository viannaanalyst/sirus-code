import "../../src/styles/index.css";
import "./preview.css";
import { ShaderMount, liquidMetalFragmentShader } from "@paper-design/shaders";
import { composerMetalUniforms, mountComposerMetalBorder } from "../../src/lib/composer-metal";
import { motionTokens } from "../../src/lib/motion";

export const variants = {
  silver: { name: "Linha de prata", title: "Sua referência, com o nosso acabamento.", description: "Uma linha contínua cede espaço à onda de voz. Prata, contraste suave e toda a largura do composer." },
  capsule: { name: "Cápsula", title: "Tudo em uma pequena peça de metal.", description: "Microfone e onda dentro de uma cápsula central. Compacta, precisa e com o mesmo acabamento dos nossos controles." },
  orbit: { name: "Órbita", title: "O ditado também entra em órbita.", description: "Um ponto percorre duas trajetórias em torno do microfone. A identidade da nossa logo, traduzida em um controle vivo." },
  rails: { name: "Trilhos", title: "Sua voz encontra um caminho.", description: "Dois fios prateados se cruzam enquanto a luz percorre os trilhos. Uma conexão entre o nome Sirus Code e o movimento da voz." },
  halo: { name: "Halo", title: "Um sinal discreto de que estamos ouvindo.", description: "Anéis suaves se expandem ao redor do microfone. Um gesto simples, com pouco movimento e bastante espaço para a sua ideia." },
} as const;
type Variant = keyof typeof variants;
const choices = Object.keys(variants) as Variant[];
const sample = "Crie uma página de projetos com busca e filtros, seguindo o visual do Sirus Code.";

const paths: Record<string, string> = {
  session: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  monitor: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5"/>',
  branch: '<path d="M6 3v12a6 6 0 0 0 12 0V9"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  hand: '<path d="M8 12V6a2 2 0 0 1 4 0v5M12 9V4a2 2 0 0 1 4 0v7M16 7a2 2 0 0 1 4 0v9c0 4-3 6-7 6-3 0-5-2-7-5L3 13a2 2 0 0 1 3-2l2 2"/>',
  up: '<path d="m6 11 6-6 6 6M12 5v14"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  square: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  text: '<path d="M4 6h16M4 12h16M4 18h10"/>',
};
document.querySelectorAll<HTMLElement>("[data-icon]").forEach(node => {
  node.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24">${paths[node.dataset.icon ?? ""] ?? ""}</svg>`;
});
document.querySelectorAll<HTMLElement>("[data-wave]").forEach(node => {
  for (let i = 0; i < Number(node.dataset.wave); i++) {
    const bar = document.createElement("b");
    bar.style.setProperty("--bar-height", `${Math.round(7 + Math.sin(i * .63) ** 2 * 22)}px`);
    bar.style.setProperty("--bar-delay", `calc(var(--motion-slow) * ${(-i * .41).toFixed(2)})`);
    node.append(bar);
  }
});

function element<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing preview element: ${selector}`);
  return node;
}
const body = document.body;
const composer = element<HTMLFormElement>("#composer");
const prompt = element<HTMLTextAreaElement>("#prompt");
const send = element<HTMLButtonElement>("#send");
const mic = element<HTMLButtonElement>("#mic");
const pause = element<HTMLButtonElement>("#motion");
const status = element<HTMLElement>("#status");
const clock = element<HTMLElement>(".record-clock");
const caption = element<HTMLElement>("#caption");
const tabs = [...document.querySelectorAll<HTMLButtonElement>("[data-choice]")];
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
const requested = new URL(window.location.href).searchParams.get("variant") ?? body.dataset.variant;
let selected: Variant = choices.includes(requested as Variant) ? requested as Variant : "silver";
let recording = true;
let paused = false;
let elapsed = 3;
let baseline = "";
let phraseStarted: number | null = null;
let partial = "";

function fitPrompt() {
  prompt.style.height = "auto";
  prompt.style.height = `${Math.min(prompt.scrollHeight, 160)}px`;
  send.disabled = !prompt.value.trim();
}
function selectVariant(variant: Variant, updateAddress = true) {
  selected = variant;
  body.dataset.variant = variant;
  tabs.forEach(tab => {
    const active = tab.dataset.choice === variant;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  element("#preview-panel").setAttribute("aria-labelledby", `tab-${variant}`);
  element("#variant-number").textContent = `${String(choices.indexOf(variant) + 1).padStart(2, "0")} / ${variants[variant].name.toUpperCase()}`;
  element("#variant-title").textContent = variants[variant].title;
  element("#variant-description").textContent = variants[variant].description;
  if (updateAddress && window.location.protocol !== "file:") {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", variant);
    window.history.replaceState(null, "", url);
  }
}
function renderState() {
  body.dataset.recording = String(recording);
  element("#record").setAttribute("aria-pressed", String(recording));
  element("#idle").setAttribute("aria-pressed", String(!recording));
  caption.textContent = recording ? "Ditado simulado em andamento" : "Clique no microfone para experimentar";
  mic.setAttribute("aria-pressed", String(recording));
  clock.textContent = `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, "0")}`;
  fitPrompt();
}

function mountPreview() {
  const events = new AbortController();
  let inView = true;
  let frame = 0;
  let previous = 0;
  let clockSecond = -1;
  let disposed = false;
  let border: ReturnType<typeof mountComposerMetalBorder> | undefined;
  const metals: { node: HTMLElement; shader: ShaderMount }[] = [];
  const listen = (node: EventTarget, name: string, callback: EventListener) => node.addEventListener(name, callback, { signal: events.signal });
  const canMove = () => !disposed && !paused && !reduced.matches && !document.hidden && inView;
  const stopFrame = () => { window.cancelAnimationFrame(frame); frame = 0; previous = 0; };
  function paintFrame(now: number) {
    frame = 0;
    if (!canMove() || !recording) { previous = 0; return; }
    if (previous) elapsed += Math.min((now - previous) / 1000, motionTokens.instant);
    previous = now;
    if (Math.floor(elapsed) !== clockSecond) {
      clockSecond = Math.floor(elapsed);
      clock.textContent = `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, "0")}`;
    }
    if (phraseStarted !== null) {
      const count = Math.min(sample.length, Math.floor((elapsed - phraseStarted) * 17));
      const next = sample.slice(0, count);
      if (next !== partial) {
        partial = next;
        prompt.value = [baseline, partial].filter(Boolean).join(" ");
        fitPrompt();
      }
      if (count === sample.length) phraseStarted = null;
    }
    frame = window.requestAnimationFrame(paintFrame);
  }
  function syncMotion() {
    if (disposed) return;
    const moving = canMove();
    body.dataset.motion = String(moving && recording);
    border?.setMotion({ speed: "slow", reduced: !moving || recording });
    element(".composer-contour").dataset.reduced = String(!moving || recording);
    pause.disabled = reduced.matches;
    pause.setAttribute("aria-pressed", String(paused));
    pause.querySelector("span")!.textContent = reduced.matches ? "Movimento reduzido" : paused ? "Retomar movimento" : "Pausar movimento";
    pause.querySelector("i")!.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24">${paused ? paths.play : paths.pause}</svg>`;
    metals.forEach(({ node, shader }) => shader.setSpeed(moving && !recording && (node.matches(":hover") || node.matches(":focus-visible")) ? 1 : 0));
    if (moving && recording) { if (!frame) frame = window.requestAnimationFrame(paintFrame); }
    else stopFrame();
  }
  function begin() {
    if (recording) return;
    baseline = prompt.value;
    partial = "";
    phraseStarted = null;
    elapsed = 0;
    recording = true;
    clockSecond = -1;
    renderState(); syncMotion();
    status.textContent = "Ditado simulado iniciado. Experimente a frase de exemplo.";
  }
  function end(cancelled: boolean, focusComposer = true) {
    if (!recording) return;
    if (cancelled) prompt.value = baseline;
    else if (!prompt.value.trim()) prompt.value = sample;
    recording = false;
    phraseStarted = null;
    partial = "";
    stopFrame(); renderState(); syncMotion();
    status.textContent = cancelled ? "Demonstração cancelada. Seu texto anterior foi preservado." : "Ditado concluído. O texto está no composer para você revisar.";
    if (focusComposer) mic.focus();
  }
  const visibility = new IntersectionObserver(entries => { inView = entries[0].isIntersecting; syncMotion(); });
  visibility.observe(composer);
  listen(document, "visibilitychange", syncMotion);
  listen(reduced, "change", syncMotion);
  listen(pause, "click", () => { paused = !paused; syncMotion(); });
  listen(mic, "click", begin);
  listen(element("#record"), "click", begin);
  listen(element("#idle"), "click", () => end(true, false));
  listen(element("#cancel"), "click", () => end(true));
  listen(element("#finish"), "click", () => end(false));
  listen(element("#phrase"), "click", () => {
    if (phraseStarted !== null) return;
    begin(); baseline = prompt.value; partial = ""; phraseStarted = elapsed;
    if (!canMove()) { prompt.value = [baseline, sample].filter(Boolean).join(" "); phraseStarted = null; fitPrompt(); }
    status.textContent = "Frase de exemplo. Cancelar restaura o texto anterior; concluir mantém a transcrição.";
  });
  listen(prompt, "input", () => { baseline = prompt.value; partial = ""; phraseStarted = null; fitPrompt(); });
  listen(composer, "submit", event => { event.preventDefault(); status.textContent = "Envio simulado. Seu texto continua aqui."; });
  listen(composer, "keydown", event => { if ((event as KeyboardEvent).key === "Escape" && recording) { event.preventDefault(); end(true); } });
  listen(element("#add"), "click", () => { status.textContent = "Contexto de exemplo selecionado para este preview."; });
  tabs.forEach(tab => {
    listen(tab, "click", () => selectVariant(tab.dataset.choice as Variant));
    listen(tab, "keydown", event => {
      const key = (event as KeyboardEvent).key;
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
      event.preventDefault();
      const index = choices.indexOf(selected);
      const next = key === "Home" ? 0 : key === "End" ? choices.length - 1 : (index + (key === "ArrowRight" ? 1 : -1) + choices.length) % choices.length;
      selectVariant(choices[next]); tabs[next].focus();
    });
  });
  for (const node of [element<HTMLElement>("#add"), mic]) {
    try {
      const shader = new ShaderMount(node.querySelector<HTMLElement>(".composer-metal-surface")!, liquidMetalFragmentShader, composerMetalUniforms(), { alpha: false, antialias: false, powerPreference: "low-power" }, 0, 700, 1, 72 * 72);
      metals.push({ node, shader });
      for (const event of ["pointerenter", "pointerleave", "focus", "blur"]) listen(node, event, syncMotion);
    } catch { node.querySelector(".composer-metal-surface")!.replaceChildren(); }
  }
  try { border = mountComposerMetalBorder(element(".composer-contour"), ShaderMount, liquidMetalFragmentShader, { speed: "slow", reduced: true }); }
  catch { element(".composer-contour").replaceChildren(); }
  renderState(); syncMotion();
  return () => {
    disposed = true; stopFrame(); events.abort(); visibility.disconnect(); border?.dispose();
    for (const { shader } of metals) { const gl = shader.canvasElement.getContext("webgl2"); shader.dispose(); gl?.getExtension("WEBGL_lose_context")?.loseContext(); }
    body.dataset.motion = "false";
  };
}

selectVariant(selected, false);
let cleanup: (() => void) | undefined = mountPreview();
window.addEventListener("pagehide", () => { cleanup?.(); cleanup = undefined; });
window.addEventListener("pageshow", () => { if (!cleanup) cleanup = mountPreview(); });
