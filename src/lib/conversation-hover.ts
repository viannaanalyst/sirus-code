import type { FileChange, Message, Session } from "@/client/types";
import { maskSecrets } from "@/lib/redact";

/**
 * The conversation list's hover card (ADR-139): what it shows and when it opens. One card
 * serves the whole list; rows never re-render for it.
 */

/** Pointer rest on a row before the first card opens. */
export const HOVER_OPEN_MS = 450;
/** Grace after the pointer leaves a row, so moving to the next one switches cards instead of closing. */
export const HOVER_GRACE_MS = 120;
/** Just after a card closed, the next row's opens at once. */
export const HOVER_WARM_MS = 300;
/** Longest reply preview, in characters (mirrors `reply_preview.rs`). */
export const SNIPPET_MAX = 280;
/** Only the end of a reply is read for its last paragraph. */
const SNIPPET_WINDOW = 4096;

export type HoverPill = "working" | "needsYou" | "failed";

/** A pill only for working, needing the person (an approval, a question, the computer) or failed; none once finished or idle. */
export function hoverPill(session: Pick<Session, "status" | "pendingRequests">, computerWaiting = false): HoverPill | null {
  if (session.status === "waiting" || (session.pendingRequests?.length ?? 0) > 0 || computerWaiting) return "needsYou";
  if (session.status === "running" || session.status === "starting") return "working";
  return session.status === "failed" ? "failed" : null;
}

const RULE = /^(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,}|\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?)$/;
const BLOCK = /^(?:>\s?)*\s*(?:#{1,6}\s+|(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)?/;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const LINK = /\[([^\]]+)\](?:\([^)]*\)|\[[^\]]*\])/g;
const AUTOLINK = /<((?:https?|mailto):[^>\s]+)>/g;
const TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g;
const STRONG = /(^|[^\p{L}\p{N}_])(\*\*|__|~~)(\S(?:.*?\S)?)(?:\*\*|__|~~)/gu;
const EMPHASIS = /(^|[^\p{L}\p{N}_*])[*_]([^*_\s](?:[^*_]*[^*_\s])?)[*_]/gu;

const isFence = (line: string) => /^\s*(?:```|~~~)/.test(line);

/** One line of Markdown as plain text; empty when nothing readable is left. */
function plainLine(raw: string): string {
  const line = raw.trim();
  if (RULE.test(line)) return "";
  let text = line.replace(BLOCK, "").replace(IMAGE, "$1").replace(LINK, "$1").replace(AUTOLINK, "$1").replace(TAG, "").replaceAll("`", "")
    .replace(STRONG, "$1$3").replace(EMPHASIS, "$1$2");
  if (text.trimStart().startsWith("|")) text = text.replaceAll("|", " ");
  return text.trim().replace(/\s+/g, " ");
}

/** At most `SNIPPET_MAX` characters, cut at a word when one ends near the limit. */
function clip(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= SNIPPET_MAX) return text;
  const cut = chars.slice(0, SNIPPET_MAX - 1).join("");
  const space = cut.search(/\s\S*$/);
  const word = space >= 0 && Array.from(cut.slice(0, space)).length > SNIPPET_MAX - 40 ? cut.slice(0, space) : cut;
  return `${word.trimEnd()}…`;
}

/**
 * The last paragraph of a reply that has words, as plain text: Markdown dropped (emphasis,
 * code marks, headings, lists, quotes, tables; links as their text), code blocks skipped,
 * credentials masked, at most 280 characters. Mirrors `reply_preview::excerpt`.
 */
export function replySnippet(content: string): string | null {
  let start = Math.max(0, content.length - SNIPPET_WINDOW);
  let inFence = false;
  if (start > 0) {
    // The cut line is dropped; whether the window starts inside a code block depends on the fences before it.
    const newline = content.indexOf("\n", start);
    start = newline < 0 ? content.length : newline + 1;
    inFence = content.slice(0, start).split("\n").filter(isFence).length % 2 === 1;
  }
  let paragraph: string[] = [];
  let last: string[] = [];
  for (const line of content.slice(start).split(/\r?\n/)) {
    const fence = isFence(line);
    if (fence) inFence = !inFence;
    const plain = fence || inFence ? "" : plainLine(line);
    if (plain) paragraph.push(plain);
    else if (paragraph.length) { last = paragraph; paragraph = []; }
  }
  if (paragraph.length) last = paragraph;
  return last.length ? clip(maskSecrets(last.join(" "))) : null;
}

/**
 * What the conversation said last. A loaded transcript is read (so a running reply shows
 * its newest streamed paragraph); otherwise the native `lastReplyPreview` from the metadata.
 */
export function lastReplySnippet(session: Pick<Session, "messages" | "lastReplyPreview">): string | null {
  const messages: readonly Message[] = session.messages;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "agent" || !message.content) continue;
    const snippet = replySnippet(message.content);
    if (snippet) return snippet;
  }
  return session.lastReplyPreview?.trim() || null;
}

export interface DiffTotals { additions: number; deletions: number }

/** `+N` and `−M` for a workspace with changes; null when unknown or nothing changed. */
export function diffParts(totals: DiffTotals | null | undefined): { added: string; removed: string } | null {
  if (!totals || (!totals.additions && !totals.deletions)) return null;
  return { added: `+${totals.additions}`, removed: `−${totals.deletions}` };
}

/**
 * Lines changed in the conversation's own workspace. Only a conversation with its own
 * worktree has numbers of its own, and they are known only while it is selected (the Git
 * status the window already reads); a shared checkout's totals belong to the project.
 */
export function workspaceDiff(session: Pick<Session, "id" | "worktree">, selected: { sessionId: string | null; changes: readonly Pick<FileChange, "additions" | "deletions">[] | null | undefined }): DiffTotals | null {
  if (!session.worktree.isolated || selected.sessionId !== session.id || !selected.changes) return null;
  return selected.changes.reduce((sum, change) => ({ additions: sum.additions + (change.additions || 0), deletions: sum.deletions + (change.deletions || 0) }), { additions: 0, deletions: 0 });
}

export interface HoverTimers {
  set: (callback: () => void, ms: number) => number;
  clear: (id: number) => void;
  now: () => number;
}

const windowTimers: HoverTimers = {
  set: (callback, ms) => window.setTimeout(callback, ms),
  clear: (id) => window.clearTimeout(id),
  now: () => performance.now(),
};

/**
 * When the one shared card shows and for which row. The first card waits `HOVER_OPEN_MS`;
 * while one is open (or just closed) the next row's opens at once; leaving waits a short
 * grace. A click keeps that row's card closed until the pointer leaves it; while blocked
 * (a context menu is open) nothing opens.
 */
export class HoverCardController<T extends { id: string }> {
  private shown: T | null = null;
  private opening = 0;
  private closing = 0;
  private closedAt = -Infinity;
  private blocked = false;
  private dismissed: string | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly timers: HoverTimers;

  constructor(timers: HoverTimers = windowTimers) {
    this.timers = timers;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  current = () => this.shown;

  enter(target: T) {
    this.cancel("closing");
    if (this.blocked || this.dismissed === target.id || this.shown?.id === target.id) return;
    this.cancel("opening");
    if (this.shown || this.timers.now() - this.closedAt < HOVER_WARM_MS) { this.show(target); return; }
    this.opening = this.timers.set(() => { this.opening = 0; this.show(target); }, HOVER_OPEN_MS);
  }

  leave(id: string) {
    if (this.dismissed === id) this.dismissed = null;
    this.cancel("opening");
    if (!this.shown || this.closing) return;
    this.closing = this.timers.set(() => { this.closing = 0; this.show(null); }, HOVER_GRACE_MS);
  }

  /** Closes now; `id` (a clicked row) stays closed until the pointer leaves it. */
  dismiss(id: string | null = null) {
    this.cancel("opening");
    this.cancel("closing");
    this.dismissed = id;
    this.show(null);
  }

  block(on: boolean) {
    this.blocked = on;
    if (on) this.dismiss();
  }

  private cancel(which: "opening" | "closing") {
    if (!this[which]) return;
    this.timers.clear(this[which]);
    this[which] = 0;
  }

  private show(target: T | null) {
    if (target === this.shown) return;
    if (!target) this.closedAt = this.timers.now();
    this.shown = target;
    this.listeners.forEach((listener) => listener());
  }
}
