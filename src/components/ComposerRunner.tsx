import { useEffect, useRef, useState } from "react";
import type { AgentProviderId } from "@/client/types";
import { useAmbientActive } from "@/lib/ambient-motion";
import { modelBrandAsset, resolveModelBrand } from "@/lib/model-brand";
import { RUNNER_EXIT_MS, RUNNER_SIZE, runnerPose, type RunnerPlatform, type RunnerSpeed } from "@/lib/composer-runner";
import { cn } from "@/lib/cn";

/**
 * While the agent works, the working model's own mark runs along the composer's top edge
 * (`src/lib/composer-runner.ts`). The background tasks pill resting on that edge is a platform
 * it climbs onto and runs across. It stays mounted through its last jump when the turn ends,
 * pauses with the other ambient loops and, with reduced motion, rests at the edge's start.
 */
export function ComposerRunner({ running, provider, modelId, speed, reduce }: {
  running: boolean;
  provider: AgentProviderId;
  modelId: string;
  speed: RunnerSpeed;
  reduce: boolean;
}) {
  const [shown, setShown] = useState(running);
  const element = useRef<HTMLSpanElement>(null);
  const startedAt = useRef(performance.now());
  const leftAt = useRef<number | null>(null);
  const width = useRef(0);
  const platform = useRef<RunnerPlatform | null>(null);
  const measuredAt = useRef(-Infinity);
  const ambient = useAmbientActive();

  if (running && !shown) setShown(true);
  useEffect(() => {
    if (running) {
      startedAt.current = performance.now();
      leftAt.current = null;
      return;
    }
    leftAt.current = performance.now();
    const timer = window.setTimeout(() => setShown(false), RUNNER_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [running]);

  // The edge's length, read on resize instead of every frame.
  useEffect(() => {
    const box = element.current?.parentElement;
    if (!shown || !box) return;
    width.current = box.offsetWidth;
    const observer = new ResizeObserver(([entry]) => { width.current = entry.contentRect.width; });
    observer.observe(box);
    return () => observer.disconnect();
  }, [shown]);

  useEffect(() => {
    if (!shown) return;
    let frame = 0;
    const draw = (now: number) => {
      const node = element.current;
      if (!node) return;
      if (now - measuredAt.current > PLATFORM_MEASURE_MS) {
        measuredAt.current = now;
        platform.current = node.parentElement ? platformAbove(node.parentElement) : null;
      }
      const leaving = leftAt.current === null ? 0 : Math.min(1, (now - leftAt.current) / RUNNER_EXIT_MS);
      const pose = runnerPose((now - startedAt.current) / 1000, width.current, speed, reduce, leaving, platform.current);
      node.style.opacity = String(pose.opacity);
      node.style.transform = `translate(${pose.x}px, ${-pose.lift}px) rotate(${pose.lean}deg) scale(${pose.scaleX}, ${pose.scaleY})`;
      // Paused windows keep the last pose; reduced motion only moves for the exit.
      if ((ambient && !reduce) || leftAt.current !== null) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [shown, ambient, reduce, speed]);

  if (!shown) return null;
  const mark = modelBrandAsset(resolveModelBrand(modelId, provider));
  return (
    <span ref={element} className="composer-runner" style={{ width: RUNNER_SIZE, height: RUNNER_SIZE }} aria-hidden="true">
      <img src={mark.src} alt="" width={RUNNER_SIZE} height={RUNNER_SIZE} className={cn("size-full object-contain", mark.monochrome && "brand-mark-monochrome")} />
    </span>
  );
}

/** The pill moves only when it opens, closes or the layout changes: read it a few times a second. */
const PLATFORM_MEASURE_MS = 250;

/** The background tasks pill (or its open panel) right above the composer, in its coordinates. */
function platformAbove(box: HTMLElement): RunnerPlatform | null {
  let scope = box.parentElement;
  for (let depth = 0; scope && depth < 4; depth += 1, scope = scope.parentElement) {
    // The marked dock spans the column; what shows is its child, the pill or the open panel.
    const pill = scope.querySelector<HTMLElement>("[data-background-tasks]")?.firstElementChild;
    if (!pill) continue;
    const edge = box.getBoundingClientRect(), rect = pill.getBoundingClientRect();
    const height = edge.top - rect.top;
    // Only something sitting just above the edge is a platform.
    if (rect.bottom > edge.top + 1 || edge.top - rect.bottom > 24 || height <= 0) return null;
    return { left: rect.left - edge.left, right: rect.right - edge.left, height };
  }
  return null;
}
