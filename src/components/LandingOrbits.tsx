import { useEffect, useRef } from "react";
import { mountLandingOrbits } from "@/lib/landing-orbit-motion";
import { useMotionPreferences } from "@/lib/use-motion-preferences";

/** Only mounted on the empty New thread surface; decorative and pointer-transparent. */
export function LandingOrbits() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<ReturnType<typeof mountLandingOrbits> | null>(null);
  const reduced = useMotionPreferences();
  const preference = useRef(reduced);

  useEffect(() => {
    preference.current = reduced;
    controller.current?.setReduced(reduced);
  }, [reduced]);

  useEffect(() => {
    const node = canvas.current;
    const owner = node?.parentElement?.parentElement;
    if (!node || !owner) return;
    controller.current = mountLandingOrbits(node, owner, preference.current);
    return () => { controller.current?.dispose(); controller.current = null; };
  }, []);

  return <div className="landing-orbits" aria-hidden="true"><canvas ref={canvas} /><span className="landing-orbits-shade" /></div>;
}
