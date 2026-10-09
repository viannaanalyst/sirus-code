// Large diffs mount in chunks: the first chunk on open, the next whenever a sentinel
// below the last mounted row comes within DIFF_ROOT_MARGIN of the viewport.
export const DIFF_CHUNK = 400;
/** Generous margin so the next chunk is mounted before the reader reaches it. */
export const DIFF_ROOT_MARGIN = "0px 0px 800px 0px";
/** Height of one unwrapped diff row (`leading-5`), used to reserve space for unmounted rows. */
export const DIFF_ROW_HEIGHT = 20;
/** Untracked files at most this long are shown highlighted; longer ones use the chunked plain rows. */
export const DIFF_HIGHLIGHT_LIMIT = DIFF_CHUNK;

const whole = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);

/** Rows mounted when a diff opens. */
export function initialDiffCount(total: number, chunk = DIFF_CHUNK) {
  return Math.min(whole(total), Math.max(1, whole(chunk)));
}

/** Rows mounted after the sentinel is reached once more. */
export function nextDiffCount(current: number, total: number, chunk = DIFF_CHUNK) {
  return Math.min(whole(total), whole(current) + Math.max(1, whole(chunk)));
}

/** Rows to mount so that row `index` is included, rounded up to a chunk boundary. */
export function diffCountFor(index: number, total: number, chunk = DIFF_CHUNK) {
  const size = Math.max(1, whole(chunk));
  return Math.min(whole(total), (Math.floor(whole(index) / size) + 1) * size);
}

/** Space reserved below the mounted rows, so the scrollbar reflects the whole diff. */
export function reservedDiffHeight(mounted: number, total: number, rowHeight = DIFF_ROW_HEIGHT) {
  return Math.max(0, whole(total) - whole(mounted)) * rowHeight;
}
