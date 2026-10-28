/**
 * One scheduler for every project avatar (ADR-175, Performance in the architecture reference).
 *
 * There is no requestAnimationFrame per icon and nothing runs while nothing moves:
 * - an avatar repaints only when its look, state or pose changes (the component compares keys);
 * - one shared timer ticks about five times a second, and only while an avatar on screen is
 *   working; one more timer starts blinks, a few avatars at a time, and only while an avatar on
 *   screen is idle;
 * - the pointer is listened to (one passive listener, at most one pass per frame) only while an
 *   avatar is on screen, and repaints only the avatars whose gaze actually changed;
 * - everything stops while the document is hidden or the window is not focused, and with
 *   `data-animations="off"` or reduced motion the avatars keep one static frame.
 */
import { gazeToward, workingPose, type AvatarGaze, type AvatarPose, type AvatarState } from "@/lib/project-avatar";

/** Working avatars advance this often (about 5 fps). */
export const WORKING_TICK_MS = 200;
/** Time between blink rounds, and how long a blink lasts. */
export const BLINK_EVERY_MS: readonly [number, number] = [1600, 2900];
export const BLINK_FOR_MS = 140;
/** An avatar blinks in one round out of this many, so they do not blink in unison. */
export const BLINK_SPREAD = 3;

export interface AvatarTarget {
  state: AvatarState;
  /** Stable per project, spreads the blinks. */
  seed: number;
  /** Draws a pose (the owner skips the work when nothing changed). */
  paint(pose: AvatarPose): void;
  /** Centre on screen, read only when the pointer moves. */
  center(): { x: number; y: number } | null;
}

export interface SchedulerEnv {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  random(): number;
  /** The document is visible and the window focused. */
  active(): boolean;
  /** Animations are allowed (not `data-animations="off"`, not reduced motion). */
  motion(): boolean;
  /** Calls back when `active()` or `motion()` may have changed. */
  watch(onChange: () => void): () => void;
  /** Calls back with the pointer position, at most once per frame. */
  pointer(onMove: (x: number, y: number) => void): () => void;
}

interface Entry { target: AvatarTarget; visible: boolean; gaze: AvatarGaze; blinking: boolean }

export class AvatarScheduler {
  private readonly entries = new Map<AvatarTarget, Entry>();
  private tick = 0;
  private round = 0;
  private tickTimer: unknown = null;
  private blinkTimer: unknown = null;
  private unblinkTimer: unknown = null;
  private stopWatching: (() => void) | null = null;
  private stopPointer: (() => void) | null = null;

  private readonly env: SchedulerEnv;
  constructor(env: SchedulerEnv) { this.env = env; }

  /** Live registrations, for tests and diagnostics. */
  get size() { return this.entries.size; }
  get running() { return this.tickTimer !== null || this.blinkTimer !== null || this.stopPointer !== null; }

  register(target: AvatarTarget, visible = false): () => void {
    this.entries.set(target, { target, visible, gaze: 0, blinking: false });
    if (this.entries.size === 1) this.stopWatching = this.env.watch(() => this.sync());
    this.paint(this.entries.get(target)!);
    this.sync();
    return () => {
      this.entries.delete(target);
      if (!this.entries.size) { this.stopWatching?.(); this.stopWatching = null; }
      this.sync();
    };
  }

  setVisible(target: AvatarTarget, visible: boolean) {
    const entry = this.entries.get(target);
    if (!entry || entry.visible === visible) return;
    entry.visible = visible;
    if (visible) this.paint(entry); // it may have been frozen while off screen
    this.sync();
  }

  /** The target's state changed: draw it now and start or stop the timers it needs. */
  update(target: AvatarTarget) {
    const entry = this.entries.get(target);
    if (!entry) return;
    entry.blinking = false;
    this.paint(entry);
    this.sync();
  }

  private poseOf(entry: Entry): AvatarPose {
    const { state } = entry.target;
    const moving = this.env.motion();
    if (state === "waiting") return { state, blink: false, gaze: 0, bob: false, talk: false };
    if (state === "working") return moving ? workingPose(this.tick) : { state, blink: false, gaze: 0, bob: false, talk: false };
    return { state, blink: moving && entry.blinking, gaze: moving ? entry.gaze : 0, bob: false, talk: false };
  }

  private paint(entry: Entry) { entry.target.paint(this.poseOf(entry)); }

  private visible(state: AvatarState) {
    for (const entry of this.entries.values()) if (entry.visible && entry.target.state === state) return true;
    return false;
  }

  /** Starts and stops the shared timers and the pointer listener to match what is on screen. */
  private sync() {
    const live = this.env.active() && this.env.motion();
    const working = live && this.visible("working");
    const idle = live && this.visible("idle");
    if (working && this.tickTimer === null) this.tickTimer = this.env.setTimeout(() => this.onTick(), WORKING_TICK_MS);
    if (!working && this.tickTimer !== null) { this.env.clearTimeout(this.tickTimer); this.tickTimer = null; }
    if (idle && this.blinkTimer === null) this.scheduleBlink();
    if (!idle && this.blinkTimer !== null) {
      this.env.clearTimeout(this.blinkTimer); this.blinkTimer = null;
      if (this.unblinkTimer !== null) { this.env.clearTimeout(this.unblinkTimer); this.unblinkTimer = null; this.endBlink(); }
    }
    if (idle && !this.stopPointer) this.stopPointer = this.env.pointer((x, y) => this.onPointer(x, y));
    if (!idle && this.stopPointer) {
      this.stopPointer(); this.stopPointer = null;
      for (const entry of this.entries.values()) if (entry.gaze !== 0) { entry.gaze = 0; if (entry.visible) this.paint(entry); }
    }
    if (!live) for (const entry of this.entries.values()) if (entry.visible) this.paint(entry); // settle on the static frame
  }

  private onTick() {
    this.tickTimer = null;
    this.tick += 1;
    for (const entry of this.entries.values()) if (entry.visible && entry.target.state === "working") this.paint(entry);
    this.sync();
  }

  private scheduleBlink() {
    const [min, max] = BLINK_EVERY_MS;
    this.blinkTimer = this.env.setTimeout(() => this.onBlink(), min + this.env.random() * (max - min));
  }

  private onBlink() {
    this.blinkTimer = null;
    this.round += 1;
    for (const entry of this.entries.values()) {
      if (!entry.visible || entry.target.state !== "idle" || entry.target.seed % BLINK_SPREAD !== this.round % BLINK_SPREAD) continue;
      entry.blinking = true;
      this.paint(entry);
    }
    this.unblinkTimer = this.env.setTimeout(() => { this.unblinkTimer = null; this.endBlink(); }, BLINK_FOR_MS);
    this.scheduleBlink();
  }

  private endBlink() {
    for (const entry of this.entries.values()) if (entry.blinking) { entry.blinking = false; if (entry.visible) this.paint(entry); }
  }

  private onPointer(x: number, y: number) {
    const changed: Entry[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.visible || entry.target.state !== "idle") continue;
      const center = entry.target.center();
      const gaze = center ? gazeToward(x - center.x, y - center.y) : 0;
      if (gaze !== entry.gaze) { entry.gaze = gaze; changed.push(entry); }
    }
    for (const entry of changed) this.paint(entry);
  }
}

/** The scheduler for the real window; created on first use. */
let shared: AvatarScheduler | null = null;
export function avatarScheduler(): AvatarScheduler {
  shared ??= new AvatarScheduler(browserEnv());
  return shared;
}

function browserEnv(): SchedulerEnv {
  const doc = document;
  const motionQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const root = doc.documentElement;
  return {
    setTimeout: (run, ms) => window.setTimeout(run, ms),
    clearTimeout: (id) => window.clearTimeout(id as number),
    random: Math.random,
    active: () => doc.visibilityState !== "hidden" && doc.hasFocus(),
    motion: () => !motionQuery?.matches && root.dataset.animations !== "off" && root.dataset.reduceMotion !== "on",
    watch(onChange) {
      const observer = new MutationObserver(onChange);
      observer.observe(root, { attributes: true, attributeFilter: ["data-animations", "data-reduce-motion"] });
      doc.addEventListener("visibilitychange", onChange);
      window.addEventListener("focus", onChange);
      window.addEventListener("blur", onChange);
      motionQuery?.addEventListener("change", onChange);
      return () => {
        observer.disconnect();
        doc.removeEventListener("visibilitychange", onChange);
        window.removeEventListener("focus", onChange);
        window.removeEventListener("blur", onChange);
        motionQuery?.removeEventListener("change", onChange);
      };
    },
    pointer(onMove) {
      let frame = 0, x = 0, y = 0;
      const move = (event: PointerEvent) => {
        if (event.pointerType === "touch") return;
        x = event.clientX; y = event.clientY;
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; onMove(x, y); });
      };
      window.addEventListener("pointermove", move, { passive: true });
      return () => { window.removeEventListener("pointermove", move); if (frame) cancelAnimationFrame(frame); };
    },
  };
}
