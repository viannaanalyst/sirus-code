import { useEffect, useRef } from "react";
import type { ShaderMount } from "@paper-design/shaders";
import { motionTokens } from "@/lib/motion";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { composerMetalUniforms } from "@/lib/composer-metal";

/** Decorative only: the existing Radix trigger owns focus, activation and the picker. */
export function ComposerMetalSurface({ disabled }: { disabled: boolean }) {
  const surface = useRef<HTMLSpanElement>(null);
  const reduced = useMotionPreferences();

  useEffect(() => {
    const node = surface.current;
    const button = node?.closest("button");
    if (!node || !button || disabled || reduced) return;
    let disposed = false;
    let shader: ShaderMount | undefined;
    let hovered = button.matches(":hover");
    let focused = button.matches(":focus-visible");
    let pulse: ReturnType<typeof setTimeout> | undefined;
    const settle = () => shader?.setSpeed(hovered || focused ? 1 : 0);
    const enter = () => { hovered = true; settle(); };
    const leave = () => { hovered = false; settle(); };
    const focus = () => { focused = button.matches(":focus-visible"); settle(); };
    const blur = () => { focused = false; settle(); };
    const press = () => {
      if (pulse) clearTimeout(pulse);
      shader?.setSpeed(2.4);
      pulse = setTimeout(settle, motionTokens.slow * 1000);
    };
    button.addEventListener("pointerenter", enter);
    button.addEventListener("pointerleave", leave);
    button.addEventListener("focus", focus);
    button.addEventListener("blur", blur);
    button.addEventListener("click", press);

    // Only the liquid-metal shader and mount are bundled in this lazy chunk.
    // ShaderMount itself pauses outside the viewport and while the document is hidden.
    void import("@paper-design/shaders").then(({ ShaderMount, liquidMetalFragmentShader }) => {
      if (disposed) return;
      try {
        shader = new ShaderMount(node, liquidMetalFragmentShader, composerMetalUniforms(), { alpha: false, antialias: false, powerPreference: "low-power" }, 0, 700, 1, 72 * 72);
        settle();
      } catch {
        // WebGL is optional: retain the static metallic CSS surface.
        node.replaceChildren();
      }
    }).catch(() => { /* The static surface also covers a failed lazy chunk load. */ });

    return () => {
      disposed = true;
      if (pulse) clearTimeout(pulse);
      button.removeEventListener("pointerenter", enter);
      button.removeEventListener("pointerleave", leave);
      button.removeEventListener("focus", focus);
      button.removeEventListener("blur", blur);
      button.removeEventListener("click", press);
      const gl = shader?.canvasElement.getContext("webgl2");
      shader?.dispose();
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [disabled, reduced]);

  return <><span ref={surface} className="composer-metal-surface" aria-hidden="true" /><span className="composer-metal-core" aria-hidden="true" /></>;
}
