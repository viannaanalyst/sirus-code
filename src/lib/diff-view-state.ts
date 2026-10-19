// Where each review tab was (ADR-145): scroll position, collapsed files and the file in view,
// kept in memory per view key while the tab or pane is switched away and back. Bounded; never
// persisted, so a restart opens reviews at the top.
import { BoundedCache } from "./diff-cache";

export interface DiffViewState {
  scrollTop: number;
  scrollLeft: number;
  collapsed: string[];
  /** The file in view (or chosen) when the review was left. */
  selected: string | null;
  /** What the surface was opened with (a file path), so a new request is not overridden by an old place. */
  origin?: string | null;
}

export const DIFF_VIEW_STATES = 64;
const states = new BoundedCache<string, DiffViewState>(DIFF_VIEW_STATES);

export function diffViewState(key: string | null | undefined): DiffViewState | undefined {
  return key ? states.get(key) : undefined;
}

/** Merges `patch` into the key's state (creating it); returns the stored state. */
export function rememberDiffView(key: string | null | undefined, patch: Partial<DiffViewState>): DiffViewState | undefined {
  if (!key) return undefined;
  const current = states.get(key) ?? { scrollTop: 0, scrollLeft: 0, collapsed: [], selected: null };
  const next = { ...current, ...patch };
  next.scrollTop = Number.isFinite(next.scrollTop) ? Math.max(0, next.scrollTop) : 0;
  next.scrollLeft = Number.isFinite(next.scrollLeft) ? Math.max(0, next.scrollLeft) : 0;
  return states.set(key, next);
}

export function forgetDiffView(key: string) { states.delete(key); }
