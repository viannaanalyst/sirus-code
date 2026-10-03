import { motionTokens } from "@/lib/motion";

/** The logo needs this long after launch to finish arriving, so a fast load never cuts it mid-animation. */
const MIN_VISIBLE_MS = 1100;
const ms = (seconds: number) => seconds * 1000;
let dismissing = false;

function motionReduced() {
  const root = document.documentElement;
  return root.dataset.reduceMotion === "on" || root.dataset.animations === "off" || matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Dismisses the static launch splash from index.html once the app is ready. When the landing
 * glyph is on screen the splash logo flies into it; otherwise the logo and glass dissolve.
 */
export function dismissAppSplash() {
  const splash = document.getElementById("app-splash");
  if (!splash || dismissing) return;
  dismissing = true;
  const wait = Math.max(0, MIN_VISIBLE_MS - performance.now());
  setTimeout(() => requestAnimationFrame(() => void leave(splash)), wait);
}

async function leave(splash: HTMLElement) {
  // The app becomes visible under the glass only now, so the splash never changes mid-launch.
  splash.setAttribute("data-leaving", "");
  const reduced = motionReduced();
  const logo = splash.querySelector<HTMLElement>(".app-splash-logo");
  const ease = `cubic-bezier(${motionTokens.ease.join(",")})`;
  const fade = (element: Element | null, duration: number, delay = 0) => element?.animate([{ opacity: 1 }, { opacity: 0 }], { duration, delay, easing: ease, fill: "forwards" }).finished;
  // Infinite loops stop so the exit reads as one motion.
  splash.querySelectorAll(".app-splash-sheen, .app-splash-glow").forEach(node => node.getAnimations().forEach(animation => animation.cancel()));
  splash.querySelectorAll(".app-splash-glow").forEach(node => void fade(node, ms(motionTokens.fast)));
  const target = document.querySelector<HTMLElement>("[data-landing-glyph]");
  const from = logo?.getBoundingClientRect(), to = target?.getBoundingClientRect();
  const visible = !!to && to.width > 0 && to.bottom > 0 && to.top < innerHeight;
  try {
    if (reduced || !logo || !from) {
      await fade(splash, ms(motionTokens.fast));
    } else if (visible && target && to) {
      target.style.opacity = "0";
      const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2);
      const glass = splash.animate([{ backgroundColor: getComputedStyle(splash).backgroundColor, backdropFilter: "blur(40px) saturate(1.6)" }, { backgroundColor: "transparent", backdropFilter: "blur(0px) saturate(1)" }], { duration: ms(motionTokens.reveal) - ms(motionTokens.fast), delay: ms(motionTokens.instant) / 2, easing: ease, fill: "forwards" });
      await logo.animate([{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(${to.height / from.height})` }], { duration: ms(motionTokens.reveal), easing: "cubic-bezier(.65,0,.25,1)", fill: "forwards" }).finished;
      await glass.finished;
      target.style.opacity = "";
    } else {
      logo.animate([{ opacity: 1, transform: "none", filter: "blur(0)" }, { opacity: 0, transform: "scale(1.12)", filter: "blur(4px)" }], { duration: ms(motionTokens.slow), easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" });
      await fade(splash, ms(motionTokens.reveal) - ms(motionTokens.fast), ms(motionTokens.fast));
    }
  } finally {
    if (target) target.style.opacity = "";
    splash.remove();
  }
}
