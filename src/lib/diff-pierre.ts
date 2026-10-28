// Our diff model to @pierre/diffs (ADR-169). The app keeps its own parsed rows (`DiffLine`,
// diff-cache.ts) for comments, review guides and find; Pierre draws the diff from a patch. This
// file builds that patch and maps between the two: a selection in Pierre (side + line number) is
// a range of row indexes in ours, and the other way around.
import { parsePatchFiles, type FileDiffMetadata, type SelectedLineRange } from "@pierre/diffs";
import { BoundedCache, cachedDiffLines } from "./diff-cache";
import type { DiffLine } from "./transcript";

const UNTRACKED = "+++ untracked\n";

/** FNV-1a, as base 36: a short stable key for a patch's text. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(36);
}

/**
 * The text Pierre parses for one file: a git diff as it is, an untracked file as an all-added
 * patch, and a bare hunk list with the file headers it lacks. Empty when there is nothing to draw.
 */
export function patchText(path: string, diff: string): string {
  if (!diff) return "";
  if (diff.startsWith(UNTRACKED)) {
    const lines = diff.slice(UNTRACKED.length).split("\n");
    if (lines.at(-1) === "") lines.pop();
    if (!lines.length) return "";
    return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}\n`;
  }
  if (diff.startsWith("diff --git ")) return diff;
  const hunk = diff.search(/^@@ /m);
  if (hunk < 0) return "";
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${diff.slice(hunk)}`;
}

/** Parsed patches: about 24 MB of diff text, or 96 files. Keyed by path and text. */
const parsed = new BoundedCache<string, FileDiffMetadata | null>(96, 24 * 1024 * 1024);

/** Pierre's model of one file's diff, or null when it has no text hunks (binary, empty, omitted). Cached per text. */
export function fileDiffFor(path: string, diff: string): FileDiffMetadata | null {
  if (!diff) return null;
  const key = `${path}\0${diff}`;
  const cached = parsed.get(key);
  if (cached !== undefined) return cached;
  const patch = patchText(path, diff);
  let file: FileDiffMetadata | undefined;
  if (patch) {
    try { file = parsePatchFiles(patch, `sirus:${hashText(key)}`, false)[0]?.files[0]; } catch { file = undefined; }
  }
  const result = file && file.hunks.length ? { ...file, name: path } : null;
  return parsed.set(key, result, diff.length);
}

/** For tests: forget every parsed patch. */
export function clearParsedPatches() { parsed.clear(); }

type Side = "additions" | "deletions";
export interface LineAddress { side: Side; lineNumber: number }

/** Where a row sits in Pierre's gutter: removed rows by their old number, the rest by their new one. Headers have none. */
export function addressOfLine(line: DiffLine): LineAddress | null {
  if (line.kind === "deletion" && line.oldLine !== null) return { side: "deletions", lineNumber: line.oldLine };
  if ((line.kind === "addition" || line.kind === "context") && line.newLine !== null) return { side: "additions", lineNumber: line.newLine };
  return null;
}

const indexes = new WeakMap<readonly DiffLine[], { additions: Map<number, number>; deletions: Map<number, number> }>();
function indexOf(lines: readonly DiffLine[]) {
  let found = indexes.get(lines);
  if (found) return found;
  found = { additions: new Map(), deletions: new Map() };
  lines.forEach((line, at) => {
    if (line.kind === "header") return;
    if (line.newLine !== null) found!.additions.set(line.newLine, at);
    if (line.oldLine !== null) found!.deletions.set(line.oldLine, at);
  });
  indexes.set(lines, found);
  return found;
}

/** The row at a gutter address, or -1. */
export function lineAt(lines: readonly DiffLine[], side: Side, lineNumber: number): number {
  return indexOf(lines)[side].get(lineNumber) ?? -1;
}

/** Rows `from`..`to` as the selection Pierre draws: its first and last code rows, headers skipped. */
export function selectionOfRows(lines: readonly DiffLine[], from: number, to: number): SelectedLineRange | null {
  let first = -1, last = -1;
  for (let at = Math.max(0, from); at <= Math.min(to, lines.length - 1); at++) {
    if (addressOfLine(lines[at])) { if (first < 0) first = at; last = at; }
  }
  if (first < 0) return null;
  const start = addressOfLine(lines[first])!, end = addressOfLine(lines[last])!;
  return { start: start.lineNumber, side: start.side, end: end.lineNumber, endSide: end.side };
}

/** The rows a Pierre selection covers, as the first and last row index; null when it matches no row. */
export function rowsOfSelection(lines: readonly DiffLine[], range: SelectedLineRange): { from: number; to: number } | null {
  const start = lineAt(lines, range.side ?? "additions", range.start);
  const end = lineAt(lines, range.endSide ?? range.side ?? "additions", range.end);
  if (start < 0 || end < 0) return null;
  return { from: Math.min(start, end), to: Math.max(start, end) };
}

/** The next code row after `row` in `direction`, or -1 at the end. */
export function nextCodeRow(lines: readonly DiffLine[], row: number, direction: 1 | -1): number {
  for (let at = row + direction; at >= 0 && at < lines.length; at += direction) if (lines[at].kind !== "header") return at;
  return -1;
}

/** Parsed rows of a file's diff text, shared with the cache the guides use. */
export function rowsOfDiff(diff: string): readonly DiffLine[] { return cachedDiffLines(diff); }
