import { drawLandingOrbits } from "@/lib/landing-orbits";
import { motionTokens } from "@/lib/motion";
import { ambientActive, subscribeAmbient } from "@/lib/ambient-motion";

/** Owns a bounded, 30 fps decorative canvas; no React state or layout reads per frame. */
export function mountLandingOrbits(canvas: HTMLCanvasElement, owner: HTMLElement, reducedMotion: boolean) {
  const doc = canvas.ownerDocument;
  const view = doc.defaultView;
  const ctx = canvas.getContext("2d");
  const surface = canvas.parentElement;
  if (!view || !ctx || !surface) return { setReduced() {}, dispose() {} };
  let reduced = reducedMotion;
  let visible = true;
  let disposed = false;
  let width = 0, height = 0;
  let time = 5;
  let previous: number | undefined;
  let lastDraw = 0;
  let frame: number | undefined;
  const frameInterval = motionTokens.normal * 1000 / 6;
  let ink = "226,231,239";
  const editing = () => Boolean(doc.activeElement && owner.contains(doc.activeElement) && doc.activeElement.matches(".agent-composer textarea"));
  const running = () => !disposed && !reduced && visible && ambientActive() && !editing();
  const draw = () => {
    if (disposed || !width || !height) return;
    ctx.clearRect(0, 0, width, height);
    // 100% intensity, matching the preview at its Fast (1×) speed.
    ctx.save(); ctx.globalAlpha = 1;
    drawLandingOrbits(ctx, width, height, time, ink);
    ctx.restore();
  };
  const tick = (now: number) => {
    frame = undefined;
    if (!running()) return;
    if (previous !== undefined) time += Math.min(now - previous, motionTokens.instant * 1000) / 1000;
    previous = now;
    if (now - lastDraw >= frameInterval) { lastDraw = now; draw(); }
    frame = view.requestAnimationFrame(tick);
  };
  const sync = () => {
    surface.dataset.editing = String(editing());
    if (!running()) {
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      frame = undefined; previous = undefined;
    } else if (frame === undefined) { previous = undefined; frame = view.requestAnimationFrame(tick); }
  };
  const theme = () => {
    const token = view.getComputedStyle(canvas).getPropertyValue("--text-primary").trim();
    const light = doc.documentElement.dataset.theme === "light";
    ink = light && /^#[\da-f]{6}$/i.test(token) ? [1, 3, 5].map(start => parseInt(token.slice(start, start + 2), 16)).join(",") : "226,231,239";
    draw();
  };
  const resize = new view.ResizeObserver(([entry]) => {
    if (disposed) return;
    width = Math.max(1, entry.contentRect.width); height = Math.max(1, entry.contentRect.height);
    const ratio = Math.min(view.devicePixelRatio, 1.5, Math.sqrt(900_000 / (width * height)));
    canvas.width = Math.max(1, Math.floor(width * ratio)); canvas.height = Math.max(1, Math.floor(height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); draw();
  });
  const intersection = new view.IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
  const themeObserver = new view.MutationObserver(theme);
  resize.observe(surface);
  intersection.observe(surface);
  themeObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  owner.addEventListener("focusin", sync);
  owner.addEventListener("focusout", sync);
  const unsubscribe = subscribeAmbient(sync);
  theme(); sync();
  return {
    setReduced(value: boolean) { reduced = value; sync(); },
    dispose() {
      disposed = true; sync();
      resize.disconnect(); intersection.disconnect(); themeObserver.disconnect();
      owner.removeEventListener("focusin", sync); owner.removeEventListener("focusout", sync);
      unsubscribe();
    },
  };
}
