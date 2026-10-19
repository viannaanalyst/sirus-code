// Virtualized diff rows (ADR-145): row offsets from known or estimated heights, and the
// window of rows to mount around the viewport. Only that window is in the DOM; the content
// box keeps the whole height, so the scrollbar reflects the whole review.

/** Height of one unwrapped diff row (`leading-5`) until a mounted row has been measured. */
export const DIFF_ROW_HEIGHT = 20;
/** File header rows (`h-9`) and notice rows (`h-10`) have fixed CSS heights. */
export const DIFF_FILE_ROW_HEIGHT = 36;
export const DIFF_NOTICE_ROW_HEIGHT = 40;
/** Rows mounted beyond each edge of the viewport, in pixels, so fast scrolling never shows a gap. */
export const DIFF_OVERSCAN = 600;
/** Window edges snap to multiples of this many rows, so a scroll re-renders only when it crosses one. */
export const DIFF_WINDOW_QUANTUM = 16;
/** Viewport assumed before the scroller is measured (and when rendering on the server). */
export const DIFF_DEFAULT_VIEWPORT = 800;

const whole = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);

/**
 * Offsets of `count` rows. A row's height is its measurement when it has one, otherwise
 * `estimate(row)`; offsets are rebuilt lazily after either changes (O(rows), a few ms for
 * 100k rows), and lookups are O(1) or a binary search.
 */
export class RowLayout {
  readonly count: number;
  private measured: Float32Array;
  private offsets: Float64Array;
  private dirty = true;
  private estimate: (row: number) => number;
  constructor(count: number, estimate: (row: number) => number) {
    this.estimate = estimate;
    this.count = whole(count);
    this.measured = new Float32Array(this.count);
    this.offsets = new Float64Array(this.count + 1);
  }

  /** Replaces the estimate (a measured line height, a new width); measurements stay. */
  setEstimate(estimate: (row: number) => number) { this.estimate = estimate; this.dirty = true; }

  /** Records a measured height; true when it changed the layout. */
  measure(row: number, height: number): boolean {
    if (row < 0 || row >= this.count || !(height > 0)) return false;
    if (Math.abs(this.measured[row] - height) < 0.5) return false;
    this.measured[row] = height;
    this.dirty = true;
    return true;
  }

  heightOf(row: number): number {
    if (row < 0 || row >= this.count) return 0;
    const known = this.measured[row];
    if (known > 0) return known;
    const guess = this.estimate(row);
    return Number.isFinite(guess) && guess > 0 ? guess : DIFF_ROW_HEIGHT;
  }

  private build() {
    if (!this.dirty) return;
    let at = 0;
    for (let row = 0; row < this.count; row++) { this.offsets[row] = at; at += this.heightOf(row); }
    this.offsets[this.count] = at;
    this.dirty = false;
  }

  /** Top of `row`; `count` gives the total height. */
  offsetOf(row: number): number {
    this.build();
    return this.offsets[Math.min(this.count, Math.max(0, Math.floor(row)))];
  }

  get total(): number { return this.offsetOf(this.count); }

  /** The row covering `y` (the last row past the end, 0 above the start or when empty). */
  rowAt(y: number): number {
    this.build();
    if (this.count === 0 || !(y > 0)) return 0;
    let low = 0, high = this.count - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.offsets[middle] <= y) low = middle; else high = middle - 1;
    }
    return low;
  }
}

export interface RowWindow { start: number; end: number }

/** Rows to mount, [start, end), for a viewport from `top` to `bottom`, widened by the overscan and snapped to the quantum. */
export function windowRows(layout: Pick<RowLayout, "count" | "rowAt">, top: number, bottom: number, overscan = DIFF_OVERSCAN, quantum = DIFF_WINDOW_QUANTUM): RowWindow {
  const count = layout.count;
  if (count === 0) return { start: 0, end: 0 };
  const size = Math.max(1, whole(quantum));
  const from = layout.rowAt(Math.max(0, top - overscan));
  const to = layout.rowAt(Math.max(top, bottom) + overscan) + 1;
  const start = Math.floor(from / size) * size;
  const end = Math.min(count, Math.ceil(to / size) * size);
  return { start: Math.min(start, end), end };
}

/** Scroll position that brings rows [from, to] into view: unchanged when visible, else the
 * first row placed `margin` below the top (or centred, for `center`). */
export function scrollToReveal(layout: Pick<RowLayout, "offsetOf" | "heightOf">, from: number, to: number, scrollTop: number, viewport: number, { margin = 0, center = false }: { margin?: number; center?: boolean } = {}): number {
  const top = layout.offsetOf(from), bottom = layout.offsetOf(to) + layout.heightOf(to);
  if (!center && top >= scrollTop + margin && bottom <= scrollTop + viewport) return scrollTop;
  if (center) return Math.max(0, top - Math.max(0, (viewport - (bottom - top)) / 2));
  return Math.max(0, bottom - top > viewport - margin || top < scrollTop + margin ? top - margin : bottom - viewport);
}

/** Lines of `columns` characters a row of `length` characters wraps into. */
export function wrappedLines(length: number, columns: number): number {
  return Math.max(1, Math.ceil(whole(length) / Math.max(1, whole(columns))));
}
