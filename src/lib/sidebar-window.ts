/** Rows above this count render through a viewport window instead of all at once. */
export const SIDEBAR_WINDOW_THRESHOLD = 60;
const OVERSCAN = 12;
/** Matches the nested session grid gap in sidebar.css. */
export const SIDEBAR_WINDOW_GAP = 2;

/** First and last row to render for a list starting at `listTop` inside the scroll viewport. */
export function windowRange(count: number, rowHeight: number, listTop: number, scrollTop: number, viewport: number) {
  const step = rowHeight + SIDEBAR_WINDOW_GAP;
  const start = Math.max(0, Math.floor((scrollTop - listTop) / step) - OVERSCAN);
  const end = Math.min(count, Math.ceil((scrollTop - listTop + viewport) / step) + OVERSCAN);
  return { start: Math.min(start, end), end };
}
