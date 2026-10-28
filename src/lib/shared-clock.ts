import { useCallback, useRef, useSyncExternalStore } from "react";

/**
 * One timer per interval for every component that only needs "the time, every N ms"
 * (elapsed counters, relative ages; ADR-180). Components used to start a `setInterval`
 * each. Here all subscribers of an interval share one timer, which runs only while
 * someone listens and the document is visible, and ticks together so React batches the
 * updates into one render pass.
 */
interface Clock {
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | undefined;
  now: number;
}

const clocks = new Map<number, Clock>();
const hidden = () => typeof document !== "undefined" && document.hidden;

function run(interval: number, clock: Clock) {
  if (clock.timer !== undefined || hidden() || !clock.listeners.size) return;
  clock.timer = setInterval(() => {
    clock.now = Date.now();
    for (const listener of [...clock.listeners]) listener();
  }, interval);
}

function halt(clock: Clock) {
  if (clock.timer === undefined) return;
  clearInterval(clock.timer);
  clock.timer = undefined;
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    for (const [interval, clock] of clocks) {
      if (document.hidden) { halt(clock); continue; }
      // Shown again: catch up once, then tick.
      clock.now = Date.now();
      for (const listener of [...clock.listeners]) listener();
      run(interval, clock);
    }
  });
}

/** Calls `listener` every `interval` ms while subscribed; returns the unsubscribe. */
export function subscribeClock(interval: number, listener: () => void): () => void {
  let clock = clocks.get(interval);
  if (!clock) { clock = { listeners: new Set(), timer: undefined, now: Date.now() }; clocks.set(interval, clock); }
  const own = clock;
  if (!own.listeners.size) own.now = Date.now();
  own.listeners.add(listener);
  run(interval, own);
  return () => {
    own.listeners.delete(listener);
    if (!own.listeners.size) { halt(own); clocks.delete(interval); }
  };
}

/** How many timers run right now; tests and diagnostics read it. */
export function runningClocks(): number {
  let count = 0;
  for (const clock of clocks.values()) if (clock.timer !== undefined) count += 1;
  return count;
}

/**
 * `Date.now()` refreshed every `interval` ms while `active`; it holds its last value
 * otherwise, so a hidden or collapsed view costs nothing.
 */
export function useClock(interval: number, active = true): number {
  const last = useRef(Date.now());
  const subscribe = useCallback((listener: () => void) => active ? subscribeClock(interval, listener) : () => undefined, [interval, active]);
  const snapshot = useCallback(() => {
    if (active) last.current = clocks.get(interval)?.now ?? last.current;
    return last.current;
  }, [interval, active]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
