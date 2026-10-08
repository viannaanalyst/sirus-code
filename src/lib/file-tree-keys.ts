/**
 * Keyboard model for the Files pane tree (after MonoCode 0.4). Pure: the tree
 * reads its visible rows from the DOM and applies the returned action.
 */

/** One visible tree row, in display order. `level` starts at 1 for the root. */
export interface TreeKeyRow { name: string; level: number; isDir: boolean; expanded: boolean }

export type TreeKeyAction =
  | { type: "focus"; index: number }
  | { type: "expand"; index: number }
  | { type: "collapse"; index: number }
  | { type: "activate"; index: number }
  | { type: "none" };

/** Typeahead buffer: letters typed within `TYPEAHEAD_MS` of each other form one prefix. */
export interface TypeaheadState { buffer: string; at: number }

export const TYPEAHEAD_MS = 700;
export const emptyTypeahead: TypeaheadState = { buffer: "", at: 0 };

const clamp = (index: number, count: number) => Math.max(0, Math.min(count - 1, index));

/** The nearest earlier row one level up, or -1 at the top level. */
export function parentIndex(rows: readonly TreeKeyRow[], index: number): number {
  const level = rows[index]?.level ?? 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) if (rows[cursor].level < level) return cursor;
  return -1;
}

/** Maps one navigation key to an action; `pageSize` is the number of rows in view. */
export function treeKeyAction(rows: readonly TreeKeyRow[], index: number, key: string, pageSize = 10): TreeKeyAction {
  if (!rows.length) return { type: "none" };
  const current = clamp(index, rows.length);
  const row = rows[current];
  const page = Math.max(1, Math.floor(pageSize) - 1);
  switch (key) {
    case "ArrowDown": return { type: "focus", index: clamp(current + 1, rows.length) };
    case "ArrowUp": return { type: "focus", index: clamp(current - 1, rows.length) };
    case "Home": return { type: "focus", index: 0 };
    case "End": return { type: "focus", index: rows.length - 1 };
    case "PageDown": return { type: "focus", index: clamp(current + page, rows.length) };
    case "PageUp": return { type: "focus", index: clamp(current - page, rows.length) };
    case "ArrowRight":
      if (!row.isDir) return { type: "none" };
      if (!row.expanded) return { type: "expand", index: current };
      return rows[current + 1]?.level > row.level ? { type: "focus", index: current + 1 } : { type: "none" };
    case "ArrowLeft": {
      if (row.isDir && row.expanded) return { type: "collapse", index: current };
      const parent = parentIndex(rows, current);
      return parent >= 0 ? { type: "focus", index: parent } : { type: "none" };
    }
    case "Enter":
    case " ":
      return { type: "activate", index: current };
    default: return { type: "none" };
  }
}

/** True for a key that should feed the typeahead (one printable character, no command modifiers). */
export function isTypeaheadKey(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  return event.key.length === 1 && event.key !== " " && !event.metaKey && !event.ctrlKey && !event.altKey;
}

/**
 * Typing a filename prefix jumps to the next row whose name starts with it.
 * Repeating one letter cycles through the rows starting with that letter.
 * Returns the next buffer state and the row to focus (-1 when nothing matches).
 */
export function typeahead(state: TypeaheadState, key: string, now: number, names: readonly string[], index: number): { state: TypeaheadState; index: number } {
  const buffer = (now - state.at > TYPEAHEAD_MS ? "" : state.buffer) + key.toLowerCase();
  const next = { buffer, at: now };
  if (!names.length) return { state: next, index: -1 };
  const repeated = buffer.length > 1 && [...buffer].every((letter) => letter === buffer[0]);
  const prefix = repeated ? buffer[0] : buffer;
  // A fresh letter or a repeated one moves on; a longer prefix may keep the current row.
  const start = buffer.length === 1 || repeated ? index + 1 : index;
  for (let step = 0; step < names.length; step += 1) {
    const candidate = (((start + step) % names.length) + names.length) % names.length;
    if (names[candidate].toLowerCase().startsWith(prefix)) return { state: next, index: candidate };
  }
  return { state: next, index: -1 };
}

/** Case-aware literal match ranges, for highlighting search results. */
export function literalRanges(text: string, query: string, caseSensitive: boolean, limit = 50): { start: number; end: number }[] {
  if (!query) return [];
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  // Lowercasing can change length for a few characters; ranges only stay valid when it does not.
  if (haystack.length !== text.length) return [];
  const ranges: { start: number; end: number }[] = [];
  for (let from = haystack.indexOf(needle); from >= 0 && ranges.length < limit; from = haystack.indexOf(needle, from + needle.length)) {
    ranges.push({ start: from, end: from + needle.length });
  }
  return ranges;
}

/** Joins the workspace root and a `/`-separated relative path from the native search. */
export function workspaceFilePath(root: string, relative: string): string {
  return `${root.replace(/\/+$/, "")}/${relative.replace(/^\/+/, "")}`;
}
