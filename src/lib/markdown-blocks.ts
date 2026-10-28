/**
 * Incremental top-level splitting of a streamed Markdown reply (ADR-179; the idea follows
 * T3 Code's incremental Markdown, MIT). A reply is cut into blocks at blank lines that
 * cannot belong to something bigger: never inside a fenced code block, inside `$$` / `\[`
 * display math, or between a list and its next item or indented continuation. Every block
 * except the last is settled: the text after it has started something new, so it parses
 * the same alone as in front of anything. Only the last block, the growing tail, is scanned
 * and parsed again on the next delta, and settled blocks keep their identity (the same
 * string) so React skips them.
 *
 * Merging is always safe (the merged block parses as the original text would) and splitting
 * wrongly is not, so every doubtful case merges.
 */
export interface MarkdownBlocks {
  readonly text: string;
  /** Source of each top-level block; blank lines between blocks are not part of any. */
  readonly blocks: string[];
  /** Offset where the tail (the last block) starts in `text`. */
  readonly tailStart: number;
}

const FENCE_OPEN = /^[ \t>]*(`{3,}|~{3,})(.*)$/;
const LIST_MARKER = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/;
/** What an unfinished line looks like before it becomes a list marker. */
const MARKER_PREFIX = /^[ \t]*(?:[-*+]|\d{1,9}[.)]?)[ \t]*$/;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]\n]+\]:[ \t]*\S/m;

interface Scan {
  /** Start offsets of the blocks found, the first being `from`. */
  starts: number[];
  /** Offset just past the last non-blank line of each block. */
  ends: number[];
}

/** A line opens or closes `$$` display math when it holds an odd number of `$$` markers. */
function togglesMath(line: string): "$$" | "\\[" | "\\]" | null {
  const trimmed = line.trim();
  if (trimmed.startsWith("\\[") && !trimmed.includes("\\]")) return "\\[";
  if (trimmed.includes("\\]") && !trimmed.includes("\\[")) return "\\]";
  let count = 0;
  for (let at = trimmed.indexOf("$$"); at >= 0; at = trimmed.indexOf("$$", at + 2)) count += 1;
  return count % 2 === 1 ? "$$" : null;
}

function scan(text: string, from: number): Scan {
  const starts: number[] = [];
  const ends: number[] = [];
  let fence: { char: string; length: number } | null = null;
  let math: "$$" | "\\[" | null = null;
  let blockStartsWithList = false;
  let pendingBlank = false;
  let lastContentEnd = from;
  let position = from;
  while (position < text.length) {
    let lineEnd = text.indexOf("\n", position);
    if (lineEnd < 0) lineEnd = text.length;
    const line = text.slice(position, lineEnd);
    const next = lineEnd + 1;
    if (fence) {
      const close = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      lastContentEnd = lineEnd;
      pendingBlank = false;
    } else if (math) {
      const toggle = togglesMath(line);
      if (math === "$$" ? toggle === "$$" : toggle === "\\]") math = null;
      lastContentEnd = lineEnd;
      pendingBlank = false;
    } else if (!line.trim()) {
      pendingBlank = starts.length > 0;
    } else {
      const continues = !starts.length ? true
        : !pendingBlank ? true
        // A blank line ends a block unless an indented line or the next item of the same list follows.
        : /^(?: {2,}|\t)/.test(line) || (blockStartsWithList && LIST_MARKER.test(line))
          // The last line is still being written: "-" or "2." may become the next item of the list.
          || (blockStartsWithList && lineEnd === text.length && MARKER_PREFIX.test(line));
      if (!continues) {
        // The previous block is settled; this line starts the next one.
        blockStartsWithList = false;
      }
      if (!starts.length || !continues) {
        if (starts.length) ends.push(lastContentEnd);
        starts.push(position);
        blockStartsWithList = LIST_MARKER.test(line);
      }
      const open = FENCE_OPEN.exec(line);
      if (open && !(open[1][0] === "`" && open[2].includes("`"))) fence = { char: open[1][0], length: open[1].length };
      else {
        const toggle = togglesMath(line);
        if (toggle === "$$" || toggle === "\\[") math = toggle;
      }
      lastContentEnd = lineEnd;
      pendingBlank = false;
    }
    position = next;
  }
  if (starts.length) ends.push(lastContentEnd);
  return { starts, ends };
}

/** The blocks of `text` from scratch. */
export function splitMarkdownBlocks(text: string): string[] {
  return parseMarkdownBlocks(null, text).blocks;
}

/**
 * The blocks of `text`, reusing what `previous` (the parse of an earlier prefix) settled.
 * Text that is not an extension of the previous text, or has carriage returns, is split whole.
 */
export function parseMarkdownBlocks(previous: MarkdownBlocks | null, text: string): MarkdownBlocks {
  if (previous?.text === text) return previous;
  // Reference definitions and footnotes can point backwards or forwards across blocks.
  if (text.includes("\r") || REFERENCE_DEFINITION.test(text)) return { text, blocks: text.trim() ? [text] : [], tailStart: 0 };
  const reuse = previous !== null && previous.tailStart <= text.length && text.startsWith(previous.text) && previous.blocks.length > 0;
  const from = reuse ? previous.tailStart : 0;
  const found = scan(text, from);
  const settled = reuse ? previous.blocks.slice(0, -1) : [];
  const fresh = found.starts.map((start, index) => text.slice(start, found.ends[index]));
  const blocks = [...settled, ...fresh];
  const tailStart = found.starts.length ? found.starts[found.starts.length - 1] : from;
  return { text, blocks, tailStart };
}
