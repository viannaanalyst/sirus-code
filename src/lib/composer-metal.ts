import type { ShaderMount, ShaderMountUniforms } from "@paper-design/shaders";
import type { AppSettings } from "@/client/types";
import { ambientActive, subscribeAmbient } from "@/lib/ambient-motion";

/** One material definition for the Add button, composer border and preview. */
export function composerMetalUniforms(): ShaderMountUniforms {
  return {
    u_colorBack: [0, 0, 0, 1], u_colorTint: [1, 1, 1, 0], u_isImage: false,
    u_repetition: 4, u_softness: .5, u_shiftRed: .3, u_shiftBlue: .3,
    u_distortion: 0, u_contour: 0, u_angle: 45, u_shape: 1,
    u_fit: 1, u_scale: 8, u_rotation: 0, u_originX: .5, u_originY: .5,
    u_offsetX: .1, u_offsetY: -.1, u_worldWidth: 0, u_worldHeight: 0,
  };
}

export interface ComposerMetalMotion {
  speed: AppSettings["composerLineSpeed"];
  reduced: boolean;
}

/** How long after the last transcript scroll event the rim starts moving again. */
export const SCROLL_IDLE_MS = 250;

/**
 * Tracks transcript scrolling (`.transcript-scroll`, see SessionPane): `onChange(true)` on
 * the first scroll event, `onChange(false)` once scrolling has been idle for `idleMs`.
 * Scroll events do not bubble, so one capture-phase listener on the document hears them all.
 */
export function watchTranscriptScroll(target: Pick<Document, "addEventListener" | "removeEventListener">, onChange: (scrolling: boolean) => void, idleMs = SCROLL_IDLE_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onScroll = (event: Event) => {
    const element = event.target as Element | null;
    if (!element || typeof element.matches !== "function" || !element.matches(".transcript-scroll")) return;
    if (timer === undefined) onChange(true);
    else clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; onChange(false); }, idleMs);
  };
  target.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => {
    target.removeEventListener("scroll", onScroll, { capture: true });
    if (timer !== undefined) clearTimeout(timer);
  };
}

/**
 * ShaderMount owns resize/visibility; focus, window blur, Settings and transcript scrolling
 * stop time without resetting it (a still rim skips its per-frame render).
 */
export function mountComposerMetalBorder(node: HTMLElement, Mount: typeof ShaderMount, fragment: string, initial: ComposerMetalMotion) {
  const composer = node.parentElement;
  if (!composer) throw new Error("Composer metal requires an owning surface");
  let motion = initial;
  let scrolling = false;
  // Cover the rectangular surface: the button's contain fit clips its circular
  // material at the ends of wide composers, before the CSS rim mask is applied.
  const uniforms = { ...composerMetalUniforms(), u_fit: 2 };
  const shader = new Mount(node, fragment, uniforms,
    { alpha: false, antialias: false, powerPreference: "low-power" }, 0, 700, 1, 512 * 256);
  const sync = () => {
    const editing = composer.querySelector("textarea")?.matches(":focus");
    shader.setSpeed(motion.reduced || editing || scrolling || !ambientActive() ? 0 : { slow: .35, smooth: .55, fast: .9 }[motion.speed]);
  };
  composer.addEventListener("focusin", sync);
  composer.addEventListener("focusout", sync);
  const unsubscribe = subscribeAmbient(sync);
  const unwatchScroll = watchTranscriptScroll(document, (active) => { scrolling = active; sync(); });
  sync();
  return {
    setMotion(next: ComposerMetalMotion) { motion = next; sync(); },
    dispose() {
      composer.removeEventListener("focusin", sync);
      composer.removeEventListener("focusout", sync);
      unsubscribe();
      unwatchScroll();
      const gl = shader.canvasElement.getContext("webgl2");
      shader.dispose();
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
