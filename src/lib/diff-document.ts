// A review as one flat list of rows (ADR-145): per file, an optional header row (sticky and
// collapsible in the viewer), then either its diff lines or one notice row. The viewer only
// mounts the rows near the viewport (diff-window.ts), so the list itself stays cheap: two
// typed arrays point back into the files' parsed lines, which are never copied.
import type { DiffLine } from "./transcript";

export interface DiffDocumentFile {
  path: string;
  /** Parsed rows of the file's diff (`cachedDiffLines`); empty when there is no text diff. */
  lines: readonly DiffLine[];
  /** Shown instead of the rows when the file has none (binary, omitted, unchanged text). */
  message: string | null;
}

/** `rowLine` value of a file header row. */
export const FILE_ROW = -1;
/** `rowLine` value of a file's notice row (no text diff). */
export const NOTICE_ROW = -2;

export interface DiffDocument {
  files: readonly DiffDocumentFile[];
  /** Whether every file starts with a header row. */
  headers: boolean;
  length: number;
  /** File index of each row. */
  rowFile: Int32Array;
  /** Line index within the file, or FILE_ROW / NOTICE_ROW. */
  rowLine: Int32Array;
  /** First row of each file (its header when there are headers). */
  fileRow: Int32Array;
  collapsed: ReadonlySet<string>;
  /** Widest line in monospace columns, so the scroll width does not change as rows mount. */
  columns: number;
}

const columnsCache = new WeakMap<readonly DiffLine[], number>();
/** Monospace columns of the widest line; tabs count as four. */
export function widestLine(lines: readonly DiffLine[]): number {
  const cached = columnsCache.get(lines);
  if (cached !== undefined) return cached;
  let widest = 0;
  for (const line of lines) {
    const text = line.content;
    let width = text.length;
    for (let index = text.indexOf("\t"); index !== -1; index = text.indexOf("\t", index + 1)) width += 3;
    if (width > widest) widest = width;
  }
  columnsCache.set(lines, widest);
  return widest;
}

export function buildDiffDocument(files: readonly DiffDocumentFile[], collapsed: ReadonlySet<string> = new Set(), headers = files.length > 1): DiffDocument {
  let length = 0;
  for (const file of files) {
    const open = !headers || !collapsed.has(file.path);
    length += (headers ? 1 : 0) + (!open ? 0 : file.lines.length ? file.lines.length : headers ? 1 : 0);
  }
  const rowFile = new Int32Array(length), rowLine = new Int32Array(length), fileRow = new Int32Array(files.length);
  let row = 0, columns = 0;
  files.forEach((file, index) => {
    fileRow[index] = row;
    if (headers) { rowFile[row] = index; rowLine[row] = FILE_ROW; row++; }
    if (headers && collapsed.has(file.path)) return;
    if (file.lines.length) {
      for (let line = 0; line < file.lines.length; line++) { rowFile[row] = index; rowLine[row] = line; row++; }
      columns = Math.max(columns, widestLine(file.lines));
    } else if (headers) { rowFile[row] = index; rowLine[row] = NOTICE_ROW; row++; }
  });
  return { files, headers, length, rowFile, rowLine, fileRow, collapsed, columns };
}

/** The row showing line `line` of file `file`, or -1 when it is collapsed or out of range. */
export function rowOfLine(doc: DiffDocument, file: number, line: number): number {
  const entry = doc.files[file];
  if (!entry || line < 0 || line >= entry.lines.length) return -1;
  if (doc.headers && doc.collapsed.has(entry.path)) return -1;
  return doc.fileRow[file] + (doc.headers ? 1 : 0) + line;
}

/** The line a row shows, or null for header and notice rows. */
export function lineOfRow(doc: DiffDocument, row: number): DiffLine | null {
  if (row < 0 || row >= doc.length) return null;
  const line = doc.rowLine[row];
  return line >= 0 ? doc.files[doc.rowFile[row]].lines[line] ?? null : null;
}

/** Index of a file by path, or -1. */
export function fileIndex(doc: DiffDocument, path: string | null | undefined): number {
  return path == null ? -1 : doc.files.findIndex((file) => file.path === path);
}

const BLANK = { content: "" };
/** Rows as find targets (diff-find.ts): header and notice rows never match. */
export function searchableRows(doc: DiffDocument): { content: string }[] {
  const rows = new Array<{ content: string }>(doc.length);
  for (let row = 0; row < doc.length; row++) rows[row] = lineOfRow(doc, row) ?? BLANK;
  return rows;
}
