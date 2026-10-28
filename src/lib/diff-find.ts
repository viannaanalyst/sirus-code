// Find in a diff (⌘F inside the diff viewer, ADR-102). Matching runs over our parsed rows of
// every open file, drawn or not; the viewer scrolls to a match and paints it in Pierre's
// shadow DOM (diff-find-dom.ts, ADR-169).

/** Bounded so a one-letter query in a huge diff stays cheap to paint. */
export const DIFF_FIND_LIMIT = 2000;

export interface DiffMatch { line: number; start: number; end: number }
export type DiffMatchRange = readonly [start: number, end: number];
export interface DiffFindResult {
  matches: DiffMatch[];
  /** Ranges per line, in the order of `matches`. */
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

/** One searchable file: its parsed rows, unless it is collapsed (matches there would be hidden). */
export interface DiffSearchFile { lines: readonly { content: string; kind: string }[]; collapsed?: boolean }
export interface DiffSearchRows {
  /** Code of every row without its +/-/space marker, as Pierre draws it; header rows are blank and never match. */
  rows: { content: string }[];
  /** File and row-within-file of each entry in `rows`. */
  file: Int32Array;
  line: Int32Array;
}

const BLANK = { content: "" };
/** All rows of all open files as one list for `findDiffMatches`; `locateRow` maps a match back. */
export function searchRows(files: readonly DiffSearchFile[]): DiffSearchRows {
  let total = 0;
  for (const file of files) if (!file.collapsed) total += file.lines.length;
  const rows = new Array<{ content: string }>(total), fileOf = new Int32Array(total), lineOf = new Int32Array(total);
  let at = 0;
  files.forEach((file, index) => {
    if (file.collapsed) return;
    file.lines.forEach((line, row) => {
      rows[at] = line.kind === "header" ? BLANK : { content: line.content.slice(1) };
      fileOf[at] = index; lineOf[at] = row; at++;
    });
  });
  return { rows, file: fileOf, line: lineOf };
}

/** The file and row of a match found in `searchRows`' list. */
export function locateRow(index: DiffSearchRows, match: DiffMatch): { file: number; line: number } {
  return { file: index.file[match.line], line: index.line[match.line] };
}
