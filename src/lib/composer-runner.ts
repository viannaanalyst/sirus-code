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

/** Something resting on the composer's edge the runner climbs onto (the background tasks pill). */
export interface RunnerPlatform {
  /** Its left and right edges, from the composer's left edge. */
  left: number;
  right: number;
  /** How far its top stands above the composer's top edge. */
  height: number;
}
/** Run-up before a platform, and the run-off after it. */
const PLATFORM_RAMP = 22;
const PLATFORM_ARC = 14;
/** The mark's middle must be this far onto the platform to stand on it. */
const PLATFORM_FOOTING = 4;

/** How high the ground is under the runner's middle: the edge, a platform, or the arc between. */
export function groundLift(middle: number, platform: RunnerPlatform | null | undefined): number {
  if (!platform || platform.height <= 0) return 0;
  const onLeft = platform.left + PLATFORM_FOOTING, onRight = platform.right - PLATFORM_FOOTING;
  if (middle >= onLeft && middle <= onRight) return platform.height;
  const before = platform.left - PLATFORM_RAMP, after = platform.right + PLATFORM_RAMP;
  const arc = (k: number) => platform.height * k + Math.sin(k * Math.PI) * PLATFORM_ARC;
  if (middle > before && middle < onLeft) return arc((middle - before) / (onLeft - before));
  if (middle > onRight && middle < after) return arc((after - middle) / (after - onRight));
  return 0;
}

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
 * runs from 0 to 1 over the exit jump once the turn ended. A `platform` on the edge is climbed
 * onto, run across and jumped off. Reduced motion parks it at the start of the edge.
 */
export function runnerPose(elapsed: number, width: number, speed: RunnerSpeed, reduce: boolean, leaving = 0, platform?: RunnerPlatform | null): RunnerPose {
  const exitLift = leaving > 0 ? Math.sin(leaving * Math.PI) * EXIT_PEAK - leaving * EXIT_SINK : 0;
  const opacity = 1 - leaving * leaving;
  if (reduce) return { x: RUNNER_INSET, lift: Math.round(groundLift(RUNNER_INSET + RUNNER_SIZE / 2, platform) + exitLift), lean: 0, scaleX: 1, scaleY: 1, opacity };
  const track = Math.max(1, width - RUNNER_SIZE - RUNNER_INSET * 2);
  const lap = (elapsed * SPEED_PX[speed]) % (2 * track);
  const forward = lap < track;
  const x = RUNNER_INSET + (forward ? lap : 2 * track - lap);
  const phase = (elapsed * STEP_RATE) % 1;
  const cycle = elapsed % JUMP_EVERY;
  const jumping = cycle > JUMP_EVERY - JUMP_LENGTH;
  const jump = jumping ? Math.sin(((cycle - (JUMP_EVERY - JUMP_LENGTH)) / JUMP_LENGTH) * Math.PI) * JUMP_HEIGHT : 0;
  const ground = groundLift(x + RUNNER_SIZE / 2, platform);
  // Climbing on or off a platform is its own leap: no step bounce or squash on the arc.
  const climbing = ground > 0 && ground !== platform?.height;
  const landing = !jumping && !climbing && phase < 0.12;
  const squash = landing ? 0.9 : 1;
  return {
    x: Math.round(x),
    lift: Math.round(ground + (climbing ? 0 : Math.sin(phase * Math.PI) * STEP_HEIGHT) + jump + exitLift),
    lean: (forward ? 1 : -1) * (jumping || climbing ? 14 : 7),
    scaleX: 2 - squash,
    scaleY: squash,
    opacity,
  };
}
