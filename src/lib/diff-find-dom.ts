// Paints find matches inside Pierre's shadow DOM (ADR-169). Matches are found on our parsed
// rows (diff-find.ts); here each one is located in the line Pierre drew for it and marked with
// the CSS Custom Highlight API, so no DOM is rewritten and Pierre can re-render freely. The
// current match's line also gets an attribute, which still marks it where highlights are missing.
import { addressOfLine } from "./diff-pierre";
import type { DiffMatch } from "./diff-find";
import type { DiffLine } from "./transcript";

export const FIND_HIGHLIGHT = "sirus-find";
export const FIND_CURRENT_HIGHLIGHT = "sirus-find-current";
const LINE_MARK = "data-sirus-find-line";

/** Which text node and offset a character offset falls in, given the node lengths. `end` offsets may land on a node's end. */
export function locateOffset(lengths: readonly number[], offset: number, end = false): { node: number; offset: number } | null {
  let seen = 0;
  for (let node = 0; node < lengths.length; node++) {
    const length = lengths[node];
    if (offset < seen + length || (end && offset === seen + length)) return { node, offset: offset - seen };
    seen += length;
  }
  return null;
}

/** CSS selector of the line Pierre drew for a row, or null for headers. */
export function lineSelector(line: DiffLine): string | null {
  const address = addressOfLine(line);
  if (!address) return null;
  if (line.kind === "addition") return `[data-line-type="change-addition"][data-line="${address.lineNumber}"]`;
  if (line.kind === "deletion") return `[data-line-type="change-deletion"][data-line="${address.lineNumber}"]`;
  return `:is([data-line-type="context"], [data-line-type="context-expanded"])[data-line="${address.lineNumber}"]`;
}

function textNodes(line: Element): Text[] {
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

function rangeOf(line: Element, start: number, end: number): Range | null {
  const nodes = textNodes(line);
  const lengths = nodes.map((node) => node.length);
  const from = locateOffset(lengths, start), to = locateOffset(lengths, end, true);
  if (!from || !to) return null;
  const range = new Range();
  range.setStart(nodes[from.node], from.offset);
  range.setEnd(nodes[to.node], to.offset);
  return range;
}

type HighlightRegistry = { set(name: string, value: Highlight): unknown; delete(name: string): unknown };
function registry(): HighlightRegistry | undefined {
  return typeof CSS !== "undefined" ? (CSS as unknown as { highlights?: HighlightRegistry }).highlights : undefined;
}

/** A file drawn right now: its shadow root, parsed rows, and the matches in it with the row of each. */
export interface RenderedDiffFile { root: ParentNode; lines: readonly DiffLine[]; matches: readonly { match: DiffMatch; row: number; current: boolean }[] }

/** Highlights the matches of the files drawn right now; the current match gets the stronger colour. */
export function paintFindMatches(files: readonly RenderedDiffFile[]) {
  const all: Range[] = [], active: Range[] = [];
  for (const file of files) {
    for (const marked of file.root.querySelectorAll(`[${LINE_MARK}]`)) marked.removeAttribute(LINE_MARK);
    const lineCache = new Map<number, Element | null>();
    for (const { match, row, current } of file.matches) {
      let element = lineCache.get(row);
      if (element === undefined) {
        const selector = file.lines[row] ? lineSelector(file.lines[row]) : null;
        element = selector ? file.root.querySelector(selector) : null;
        lineCache.set(row, element);
      }
      if (!element) continue;
      if (current) element.setAttribute(LINE_MARK, "");
      const range = rangeOf(element, match.start, match.end);
      if (range) (current ? active : all).push(range);
    }
  }
  const highlights = registry();
  if (!highlights) return;
  highlights.delete(FIND_HIGHLIGHT);
  highlights.delete(FIND_CURRENT_HIGHLIGHT);
  if (all.length) highlights.set(FIND_HIGHLIGHT, new Highlight(...all));
  if (active.length) highlights.set(FIND_CURRENT_HIGHLIGHT, new Highlight(...active));
}

/** Removes every find highlight and line mark. */
export function clearFindMatches(roots: readonly ParentNode[] = []) {
  const highlights = registry();
  highlights?.delete(FIND_HIGHLIGHT);
  highlights?.delete(FIND_CURRENT_HIGHLIGHT);
  for (const root of roots) for (const marked of root.querySelectorAll(`[${LINE_MARK}]`)) marked.removeAttribute(LINE_MARK);
}
