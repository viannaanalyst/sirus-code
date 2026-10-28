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
  const running = useRef(0);
  const shownLength = useRef(text.length);
  shownLength.current = shown;
  // The loop runs only while the shown text is behind: a caught-up reply (a pause between
  // tool calls, a settled spring) costs no animation frames. New text restarts it.
  const behind = smooth && shown < text.length;
  useEffect(() => {
    if (!behind || running.current) return;
    let last = performance.now();
    const step = (now: number) => {
      const elapsed = now - last;
      // About 30 updates a second keeps the markdown re-render cheap.
      if (elapsed >= 33) {
        last = now;
        const length = target.current.length;
        const next = shownLength.current > length ? length : shownLength.current + smoothAdvance(length - shownLength.current, elapsed);
        shownLength.current = next;
        setShown(next);
        if (next >= length) { running.current = 0; return; }
      }
      running.current = requestAnimationFrame(step);
    };
    running.current = requestAnimationFrame(step);
  }, [behind, text.length]);
  useEffect(() => () => { cancelAnimationFrame(running.current); running.current = 0; }, [smooth]);
  if (!smooth) return text;
  return text.slice(0, Math.min(shown, text.length));
}
