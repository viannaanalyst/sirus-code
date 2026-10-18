import { parseChatMarkdown, type ChatBlock } from "./chat-markdown";

/**
 * Incremental `parseChatMarkdown` for a streamed reply. Every block ends at a blank
 * line and nothing looks back across one, so text that ends with a whole blank line
 * parses the same alone as in front of anything: its blocks are kept (same objects)
 * and only the text after the last blank line is parsed again. Text that shrank, no
 * longer starts with the previous text, or has carriage returns (normalized as line
 * breaks) is parsed whole.
 */
export interface ChatMarkdownParse {
  readonly text: string;
  readonly blocks: ChatBlock[];
  /** Where the last part that is parsed again starts: just after a blank line, or 0. */
  readonly boundary: number;
  /** The blocks of `text.slice(0, boundary)`, a prefix of `blocks`. */
  readonly settled: ChatBlock[];
}

const BLANK = /^\s*$/;

/** The end of the last whole blank line in `text` at or after `from` (`from` when none). */
export function lastSettledBoundary(text: string, from = 0): number {
  let end = text.lastIndexOf("\n");
  while (end >= from && end >= 0) {
    // The line before this break; at the start of the text when there is no other.
    const start = end > 0 ? text.lastIndexOf("\n", end - 1) : -1;
    if (BLANK.test(text.slice(start + 1, end))) return end + 1;
    end = start;
  }
  return from;
}

export function parseChatMarkdownStream(previous: ChatMarkdownParse | null, text: string): ChatMarkdownParse {
  if (previous?.text === text) return previous;
  const appended = previous !== null && text.length > previous.text.length && text.startsWith(previous.text) && !text.includes("\r", previous.boundary);
  if (!previous || !appended) {
    if (text.includes("\r")) return { text, blocks: parseChatMarkdown(text), boundary: 0, settled: [] };
    const boundary = lastSettledBoundary(text);
    const settled = boundary ? parseChatMarkdown(text.slice(0, boundary)) : [];
    return { text, blocks: [...settled, ...parseChatMarkdown(text.slice(boundary))], boundary, settled };
  }
  // Only what follows the previous boundary is read: new blank lines settle more of it.
  const boundary = lastSettledBoundary(text, previous.boundary);
  const settled = boundary === previous.boundary
    ? previous.settled
    : [...previous.settled, ...parseChatMarkdown(text.slice(previous.boundary, boundary))];
  return { text, blocks: [...settled, ...parseChatMarkdown(text.slice(boundary))], boundary, settled };
}
