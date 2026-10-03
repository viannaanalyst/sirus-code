import { useEffect, useRef } from "react";
import type { AppSettings } from "@/client/types";
import { mountComposerMetalBorder } from "@/lib/composer-metal";

/** The same liquid chrome as Add, masked to the composer's outer edge. */
export function ComposerContour({ speed, reducedMotion }: {
  speed: AppSettings["composerLineSpeed"];
  reducedMotion: boolean;
}) {
  const surface = useRef<HTMLSpanElement>(null);
  const controller = useRef<ReturnType<typeof mountComposerMetalBorder> | null>(null);
  const motion = useRef({ speed, reduced: reducedMotion });

  useEffect(() => {
    motion.current = { speed, reduced: reducedMotion };
    controller.current?.setMotion(motion.current);
  }, [speed, reducedMotion]);

  useEffect(() => {
    const node = surface.current;
    if (!node) return;
    let disposed = false;
    void import("@paper-design/shaders").then(({ ShaderMount, liquidMetalFragmentShader }) => {
      if (disposed) return;
      try {
        controller.current = mountComposerMetalBorder(node, ShaderMount, liquidMetalFragmentShader, motion.current);
      } catch {
        // Static CSS chrome also covers unavailable WebGL or a failed mount.
        node.replaceChildren();
      }
    }).catch(() => { /* Keep the static metal border if its lazy chunk fails. */ });
    return () => {
      disposed = true;
      controller.current?.dispose();
      controller.current = null;
    };
  }, []);

  return <span ref={surface} className="composer-contour" data-reduced={reducedMotion} aria-hidden="true" />;
}
