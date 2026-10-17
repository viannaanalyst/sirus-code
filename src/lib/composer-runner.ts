/**
 * The composer runner: while an agent works, the working model's brand mark runs along the
 * composer's top edge (after MonoCode's composer runner). Pure motion so the component only
 * writes a transform per frame.
 */

export const RUNNER_SIZE = 20;
/** Gap kept from each end of the edge. */
const RUNNER_INSET = 12;
/** Steps per second: each one is a small hop that lands slightly squashed. */
const STEP_RATE = 6.5;
const STEP_HEIGHT = 3;
/** Every so often the runner takes a high jump. */
const JUMP_EVERY = 5.6;
const JUMP_LENGTH = 0.55;
const JUMP_HEIGHT = 30;
/** The last jump when the turn ends, then the runner is gone. */
export const RUNNER_EXIT_MS = 560;
const EXIT_PEAK = 44;
const EXIT_SINK = 30;

export type RunnerSpeed = "slow" | "smooth" | "fast";
const SPEED_PX: Record<RunnerSpeed, number> = { slow: 85, smooth: 110, fast: 140 };

export interface RunnerPose {
  /** Left edge of the mark, from the composer's left edge. */
  x: number;
  /** How far the mark's bottom rises above the top edge. */
  lift: number;
  /** Lean toward the direction of travel, in degrees. */
  lean: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
}

/**
 * Where the runner is `elapsed` seconds into the turn on an edge `width` px long. `leaving`
 * runs from 0 to 1 over the exit jump once the turn ended. Reduced motion parks it at the
 * start of the edge.
 */
export function runnerPose(elapsed: number, width: number, speed: RunnerSpeed, reduce: boolean, leaving = 0): RunnerPose {
  const exitLift = leaving > 0 ? Math.sin(leaving * Math.PI) * EXIT_PEAK - leaving * EXIT_SINK : 0;
  const opacity = 1 - leaving * leaving;
  if (reduce) return { x: RUNNER_INSET, lift: exitLift, lean: 0, scaleX: 1, scaleY: 1, opacity };
  const track = Math.max(1, width - RUNNER_SIZE - RUNNER_INSET * 2);
  const lap = (elapsed * SPEED_PX[speed]) % (2 * track);
  const forward = lap < track;
  const x = RUNNER_INSET + (forward ? lap : 2 * track - lap);
  const phase = (elapsed * STEP_RATE) % 1;
  const cycle = elapsed % JUMP_EVERY;
  const jumping = cycle > JUMP_EVERY - JUMP_LENGTH;
  const jump = jumping ? Math.sin(((cycle - (JUMP_EVERY - JUMP_LENGTH)) / JUMP_LENGTH) * Math.PI) * JUMP_HEIGHT : 0;
  const landing = !jumping && phase < 0.12;
  const squash = landing ? 0.9 : 1;
  return {
    x: Math.round(x),
    lift: Math.round(Math.sin(phase * Math.PI) * STEP_HEIGHT + jump + exitLift),
    lean: (forward ? 1 : -1) * (jumping ? 14 : 7),
    scaleX: 2 - squash,
    scaleY: squash,
    opacity,
  };
}
