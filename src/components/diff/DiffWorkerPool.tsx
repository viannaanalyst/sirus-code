// The web workers that highlight diffs for @pierre/diffs (ADR-169): one shared pool that lives
// while a diff is on screen (and 30 s after), follows the app's light or dark theme, and falls
// back to the main thread if the workers cannot start.
import { WorkerPoolContext } from "@pierre/diffs/react";
import { WorkerPoolManager } from "@pierre/diffs/worker";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { diffThemeName, registerDiffThemes, type DiffAppearance } from "@/lib/diff-theme";

const IDLE_MS = 30_000;
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

/** The app's resolved theme (`data-theme` on the root, absent meaning dark). */
export function readAppearance(): DiffAppearance {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
function subscribeAppearance(listener: () => void) {
  listeners.add(listener);
  if (!observer && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(() => listeners.forEach((notify) => notify()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { observer?.disconnect(); observer = null; }
  };
}
/** Re-renders when the app switches between its light and dark theme. */
export function useDiffAppearance(): DiffAppearance {
  return useSyncExternalStore(subscribeAppearance, readAppearance, () => "dark");
}

interface Shared { pool: WorkerPoolManager; stop: () => void; consumers: number; idle: ReturnType<typeof setTimeout> | undefined }
let shared: Shared | undefined;

function poolSize() {
  const cores = typeof navigator === "undefined" ? 4 : Math.max(1, navigator.hardwareConcurrency || 4);
  return Math.max(2, Math.min(6, Math.floor(cores / 2)));
}

function applyTheme(pool: WorkerPoolManager) {
  const theme = diffThemeName(readAppearance());
  void (async () => {
    try {
      const current = pool.getDiffRenderOptions();
      if (current.theme !== theme) await pool.setRenderOptions({ ...current, theme });
    } catch (error) {
      console.error("Diff worker theme change failed", error);
    }
  })();
}

function createShared(): Shared {
  registerDiffThemes();
  const pool = new WorkerPoolManager(
    { workerFactory: () => new DiffsWorker(), poolSize: poolSize(), totalASTLRUCacheSize: 240 },
    { theme: diffThemeName(readAppearance()), preferredHighlighter: "highlights", tokenizeMaxLineLength: 1_000, useTokenTransformer: true },
  );
  const stop = subscribeAppearance(() => applyTheme(pool));
  return { pool, stop, consumers: 0, idle: undefined };
}

function subscribePool(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const entry = (shared ??= createShared());
  clearTimeout(entry.idle);
  entry.idle = undefined;
  entry.consumers += 1;
  onChange();
  return () => {
    entry.consumers -= 1;
    if (entry.consumers) return;
    entry.idle = setTimeout(() => {
      entry.stop();
      entry.pool.terminate();
      if (shared === entry) shared = undefined;
    }, IDLE_MS);
  };
}
const currentPool = () => shared?.pool;

/** Gives the diffs inside it the shared worker pool; renders them once the workers are up. */
export function DiffWorkerPool({ children, loading }: { children: ReactNode; loading: ReactNode }) {
  const pool = useSyncExternalStore(subscribePool, currentPool, () => undefined);
  const [ready, setReady] = useState<WorkerPoolManager>();
  const isReady = !pool || ready === pool || pool.isInitialized() || !pool.isWorkingPool();
  useEffect(() => {
    if (!pool || isReady) return;
    let mounted = true;
    const finish = () => { if (mounted) setReady(pool); };
    void pool.initialize().then(finish, finish);
    return () => { mounted = false; };
  }, [pool, isReady]);
  return <WorkerPoolContext.Provider value={pool}>{isReady ? children : loading}</WorkerPoolContext.Provider>;
}
