// Find in a diff (⌘F inside the diff viewer, ADR-102). Matching runs over every line of the
// diff, mounted or not; navigating mounts the chunks up to the match (see diff-window.ts).
import { diffCountFor } from "./diff-window";

/** Bounded so a one-letter query in a huge diff stays cheap to paint. */
export const DIFF_FIND_LIMIT = 2000;

export interface DiffMatch { line: number; start: number; end: number }
export type DiffMatchRange = readonly [start: number, end: number];
export interface DiffFindResult {
  matches: DiffMatch[];
  /** Ranges per line, for the rows to highlight; arrays are shared, so memoized rows stay put. */
  byLine: Map<number, DiffMatchRange[]>;
  truncated: boolean;
}

const EMPTY: DiffFindResult = { matches: [], byLine: new Map(), truncated: false };

/** Case-insensitive, non-overlapping matches in line order. */
export function findDiffMatches(lines: readonly { content: string }[], query: string, limit = DIFF_FIND_LIMIT): DiffFindResult {
  const needle = query.toLocaleLowerCase();
  if (!needle.trim()) return EMPTY;
  const matches: DiffMatch[] = [];
  const byLine = new Map<number, DiffMatchRange[]>();
  for (let line = 0; line < lines.length; line++) {
    const haystack = lines[line].content.toLocaleLowerCase();
    // Lowercasing can change length for a few scripts; skip offsets that no longer line up.
    if (haystack.length !== lines[line].content.length) continue;
    for (let from = haystack.indexOf(needle); from !== -1; from = haystack.indexOf(needle, from + needle.length)) {
      if (matches.length >= limit) return { matches, byLine, truncated: true };
      matches.push({ line, start: from, end: from + needle.length });
      const ranges = byLine.get(line);
      if (ranges) ranges.push([from, from + needle.length]); else byLine.set(line, [[from, from + needle.length]]);
    }
  }
  return { matches, byLine, truncated: false };
}

/** Next/previous match index, wrapping; with nothing current, ↓ starts at the first and ↑ at the last. */
export function stepDiffMatch(current: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return direction > 0 ? 0 : count - 1;
  return (current + direction + count) % count;
}

/** The first match at or after the line already in view, so typing does not jump backwards. */
export function firstMatchFrom(matches: readonly DiffMatch[], line: number): number {
  if (!matches.length) return -1;
  const index = matches.findIndex((match) => match.line >= line);
  return index === -1 ? 0 : index;
}

/** Rows that must be mounted so the match is on screen (whole chunks, never fewer than now). */
export function mountedForMatch(match: DiffMatch | undefined, mounted: number, total: number): number {
  return match ? Math.max(mounted, diffCountFor(match.line, total)) : mounted;
}

/** Text split around the ranges, for rendering marks; `current` marks the active match. */
export function splitByRanges(text: string, ranges: readonly DiffMatchRange[] | undefined, current: number | null) {
  const parts: { text: string; match: boolean; current: boolean }[] = [];
  let at = 0;
  for (const [start, end] of ranges ?? []) {
    if (start < at || end > text.length) continue;
    if (start > at) parts.push({ text: text.slice(at, start), match: false, current: false });
    parts.push({ text: text.slice(start, end), match: true, current: start === current });
    at = end;
  }
  if (at < text.length || !parts.length) parts.push({ text: text.slice(at), match: false, current: false });
  return parts;
}
