import { useEffect, useRef, useState } from "react";
import { useMotionPreferences } from "@/lib/use-motion-preferences";

/**
 * How far a streamed reply may advance in `ms`: a steady reading pace that speeds up
 * when the provider has sent a large burst, so the text never falls far behind.
 */
export function smoothAdvance(behind: number, ms: number): number {
  if (behind <= 0) return 0;
  const perSecond = 70 + Math.max(0, behind - 60) * 1.5;
  return Math.min(behind, Math.max(1, Math.round((perSecond * ms) / 1000)));
}

/**
 * Streamed text revealed at a steady pace instead of in the provider's bursts. Text that
 * already exists when the reply mounts shows at once (switching sessions never replays it);
 * a settled reply, a rewritten prefix or reduced motion shows everything.
 */
export function useSmoothText(text: string, streaming: boolean): string {
  const reduced = useMotionPreferences();
  const [shown, setShown] = useState(text.length);
  const target = useRef(text);
  target.current = text;
  const smooth = streaming && !reduced;
  useEffect(() => {
    if (!smooth) return;
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const elapsed = now - last;
      // About 30 updates a second keeps the markdown re-render cheap.
      if (elapsed >= 33) {
        last = now;
        setShown((current) => {
          const length = target.current.length;
          if (current > length) return length;
          return current + smoothAdvance(length - current, elapsed);
        });
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [smooth]);
  if (!smooth) return text;
  return text.slice(0, Math.min(shown, text.length));
}
