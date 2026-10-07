import { useEffect, useRef } from "react";
import type { AstroBackground, AstroIconId, AstroStyle } from "@/client/types";
import { ambientActive, subscribeAmbient } from "@/lib/ambient-motion";
import { paintAstroBackground, paintAstroIcon, type AstroActivity } from "@/lib/astro-art";
import { useMotionPreferences } from "@/lib/use-motion-preferences";

/**
 * One animation loop paints every mounted Astro icon and background. It runs
 * only while something animated is mounted and the ambient gate is open
 * (window focused, document visible, Settings closed).
 */
type Painter = (now: number) => void;
const painters = new Set<Painter>();
let frame = 0;
const STILL = 1200;

function loop(now: number) {
  for (const paint of painters) paint(now);
  frame = painters.size && ambientActive() ? requestAnimationFrame(loop) : 0;
}
function kick() {
  if (!frame && painters.size && ambientActive()) frame = requestAnimationFrame(loop);
}
if (typeof window !== "undefined") subscribeAmbient(kick);

function usePainter(paint: Painter, animate: boolean) {
  useEffect(() => {
    paint(animate ? performance.now() : STILL);
    if (!animate) return;
    painters.add(paint);
    kick();
    return () => { painters.delete(paint); };
  }, [paint, animate]);
}

/** `still` draws one frame and never joins the animation loop (dense lists such as project icons). */
export function AstroIcon({ icon, style, color, size, className, activity = "idle", still = false }: { icon: AstroIconId; style: AstroStyle; color: string; size: number; className?: string; activity?: AstroActivity; still?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useMotionPreferences();
  const paint = useRef<Painter>(() => undefined);
  useEffect(() => {
    paint.current = (now) => { if (canvas.current) paintAstroIcon(canvas.current, icon, style, color, now, activity); };
  }, [icon, style, color, activity]);
  const stable = useStablePainter(paint);
  usePainter(stable, !reduced && !still);
  useEffect(() => { stable(reduced || still ? STILL : performance.now()); }, [icon, style, color, activity, reduced, still, stable]);
  const pixels = Math.round(size * Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1));
  return <canvas ref={canvas} aria-hidden="true" width={pixels} height={pixels} className={className} style={{ width: size, height: size, display: "block" }} />;
}

/** Fills its positioned parent behind the conversation. */
export function AstroBackdrop({ background, color }: { background: AstroBackground; color: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useMotionPreferences();
  const paint = useRef<Painter>(() => undefined);
  useEffect(() => {
    paint.current = (now) => { if (canvas.current) paintAstroBackground(canvas.current, background, color, now); };
  }, [background, color]);
  const stable = useStablePainter(paint);
  usePainter(stable, !reduced && background !== "liso");
  useEffect(() => {
    stable(reduced ? STILL : performance.now());
    const node = canvas.current;
    if (!node) return;
    const observer = new ResizeObserver(() => stable(reduced ? STILL : performance.now()));
    observer.observe(node);
    return () => observer.disconnect();
  }, [background, color, reduced, stable]);
  return <canvas ref={canvas} aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 size-full" />;
}

const stablePainters = new WeakMap<{ current: Painter }, Painter>();
/** A painter whose identity never changes and that always calls the latest drawing. */
function useStablePainter(ref: { current: Painter }) {
  let stable = stablePainters.get(ref);
  if (!stable) { stable = (now: number) => ref.current(now); stablePainters.set(ref, stable); }
  return stable;
}
