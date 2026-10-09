// One bounded stack of things the user closed — header tabs, dock panes and browser tabs —
// so ⌘⇧T reopens the most recent one (ADR-102). Memory-only, like the tabs themselves.

/** How many closed things are remembered. */
export const CLOSED_ITEMS_LIMIT = 20;

export interface ClosedPane {
  id: string;
  kind: "terminal" | "files" | "changes" | "editor" | "browser" | "review" | "sidechat";
  sessionId?: string;
  path?: string;
  review?: { messageId: string; path?: string };
}
export type ClosedItem =
  | { kind: "session"; projectId: string; sessionId: string; index: number }
  | { kind: "dock"; pane: ClosedPane; index: number }
  | { kind: "browser"; sessionId: string; url: string; title: string };

export function pushClosed(stack: readonly ClosedItem[], items: readonly ClosedItem[], limit = CLOSED_ITEMS_LIMIT): ClosedItem[] {
  return [...stack, ...items].slice(-Math.max(1, limit));
}

/**
 * Pops the most recent item that can still be reopened (optionally only of one kind);
 * stale entries above it are dropped, entries of other kinds stay.
 */
export function popClosed(stack: readonly ClosedItem[], reopenable: (item: ClosedItem) => boolean, kind?: ClosedItem["kind"]): { item: ClosedItem | null; rest: ClosedItem[] } {
  const rest = [...stack];
  for (let index = rest.length - 1; index >= 0; index--) {
    const item = rest[index];
    if (kind && item.kind !== kind) continue;
    rest.splice(index, 1);
    if (reopenable(item)) return { item, rest };
  }
  return { item: null, rest };
}

/** Puts a reopened tab or pane back near where it was. */
export function insertAt<T>(list: readonly T[], value: T, index: number): T[] {
  const next = [...list];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, value);
  return next;
}

/** Blank pages are not worth remembering. */
export function rememberBrowserTab(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}
