/**
 * The transcript mounts only its last turns, after MonoCode's AgentTranscript:
 * a long conversation opens with the latest few, then the rest of the window
 * builds in a transition, and older turns arrive a page at a time.
 */

/** Turns shown once a transcript has settled. */
export const INITIAL_TURNS = 20;
/** Turns built before a transcript first paints. */
export const FIRST_PAINT_TURNS = 3;
/** Turns added each time the reader asks for earlier ones. */
export const TURN_PAGE_SIZE = 20;
/** How close to the top (px) scrolling up loads the next page. */
export const LOAD_EARLIER_THRESHOLD = 400;

/**
 * Index of the first message of each turn. A turn starts at a person's message;
 * anything before the first one belongs to the first turn.
 */
export function turnStarts(messages: readonly { role: string }[]): number[] {
  const starts: number[] = [];
  messages.forEach((message, index) => {
    if (index === 0 || message.role === "user") starts.push(index);
  });
  return starts;
}

/** Index of the first message shown when the last `turns` turns are. */
export function windowStart(starts: readonly number[], turns: number): number {
  if (!starts.length) return 0;
  return starts[Math.max(0, starts.length - Math.max(1, turns))];
}

/** Turns from the end needed to show the message at `index` (0 if out of range). */
export function turnsToReveal(starts: readonly number[], index: number): number {
  if (index < 0 || !starts.length) return 0;
  let turn = 0;
  while (turn + 1 < starts.length && starts[turn + 1] <= index) turn += 1;
  return starts.length - turn;
}

/** The window after one more page of earlier turns, never past the first. */
export function nextTurnCount(current: number, total: number): number {
  return Math.min(Math.max(total, current), current + TURN_PAGE_SIZE);
}

/** Scroll correction that keeps what the reader sees still after turns were added above. */
export function prependedScrollTop(scrollTop: number, heightBefore: number, heightAfter: number): number {
  return Math.max(0, scrollTop + heightAfter - heightBefore);
}
