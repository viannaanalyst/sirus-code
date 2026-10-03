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

/** ShaderMount owns resize/visibility; focus, window blur and Settings stop time without resetting it. */
export function mountComposerMetalBorder(node: HTMLElement, Mount: typeof ShaderMount, fragment: string, initial: ComposerMetalMotion) {
  const composer = node.parentElement;
  if (!composer) throw new Error("Composer metal requires an owning surface");
  let motion = initial;
  // Cover the rectangular surface: the button's contain fit clips its circular
  // material at the ends of wide composers, before the CSS rim mask is applied.
  const uniforms = { ...composerMetalUniforms(), u_fit: 2 };
  const shader = new Mount(node, fragment, uniforms,
    { alpha: false, antialias: false, powerPreference: "low-power" }, 0, 700, 1, 512 * 256);
  const sync = () => {
    const editing = composer.querySelector("textarea")?.matches(":focus");
    shader.setSpeed(motion.reduced || editing || !ambientActive() ? 0 : { slow: .35, smooth: .55, fast: .9 }[motion.speed]);
  };
  composer.addEventListener("focusin", sync);
  composer.addEventListener("focusout", sync);
  const unsubscribe = subscribeAmbient(sync);
  sync();
  return {
    setMotion(next: ComposerMetalMotion) { motion = next; sync(); },
    dispose() {
      composer.removeEventListener("focusin", sync);
      composer.removeEventListener("focusout", sync);
      unsubscribe();
      const gl = shader.canvasElement.getContext("webgl2");
      shader.dispose();
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
