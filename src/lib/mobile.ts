import type { FileEntry, Project, Session } from "@/client/types";
import type { LinkedDraft } from "@/lib/phone-prompt-link";
import { isAuxiliarySession } from "@/lib/pull-ask";

/**
 * The phone app (ADR-081) is a separate shell over the same store. Its screens form
 * a small stack on top of the home inbox; the browser history mirrors the stack so the
 * system back gesture closes the top screen.
 */
export type MobileScreen =
  | { kind: "projects" }
  | { kind: "settings" }
  | { kind: "chat"; sessionId: string }
  | { kind: "new"; projectId: string | null; link?: LinkedDraft }
  | { kind: "choose-project" }
  /** Clone from GitHub or type a folder path (ADR-131); `then: "new"` starts a conversation in it. */
  | { kind: "add-project"; then: "new" | "back" }
  | { kind: "snoozed" }
  | { kind: "git"; sessionId: string }
  | { kind: "files"; sessionId: string; /** A workspace path to open first (a file link in a reply). */ open?: string; dir?: boolean }
  | { kind: "review"; sessionId: string }
  | { kind: "terminal"; sessionId: string };

/** Phones get the phone app; a tablet or a wide window keeps the Mac layout. */
export const MOBILE_QUERY = "(max-width: 820px)";

/** Sessions the person sees in lists: no side chats or Astro chats. */
export function listedSessions(sessions: readonly Session[]): Session[] {
  return sessions.filter((session) => !isAuxiliarySession(session));
}

/** Waiting on an approval, a question or the person's next message. */
export function needsYou(session: Session): boolean {
  return session.status === "waiting" || !!session.pendingRequests?.length;
}

export function isWorking(session: Session): boolean {
  return !needsYou(session) && (session.status === "running" || session.status === "starting");
}

export type SessionBadge = "approve" | "question" | "working" | "failed" | "stopped" | null;

export function sessionBadge(session: Session): SessionBadge {
  const pending = session.pendingRequests ?? [];
  if (pending.some((request) => request.kind.type === "userInput")) return "question";
  if (pending.length || session.status === "waiting") return "approve";
  if (isWorking(session)) return "working";
  if (session.status === "failed") return "failed";
  if (session.status === "stopped") return "stopped";
  return null;
}

/**
 * What a one-line Home row shows in place of its project icon (ADR-129): a pulsing dot while the
 * agent works, a warning dot when it waits on the person, a danger dot when it failed.
 */
export type RowIndicator = "working" | "attention" | "failed" | null;

export function rowIndicator(session: Session): RowIndicator {
  const badge = sessionBadge(session);
  if (badge === "approve" || badge === "question") return "attention";
  if (badge === "working" || badge === "failed") return badge;
  return null;
}

const recentFirst = (list: Session[]) => list.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
const newestFirst = (list: Session[]) => list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/**
 * Home: first what needs the person, then what is running, then the rest by recency. `order`
 * is the Home's arrangement (the row menu's "Arrange", ADR-129): by last activity or by creation.
 */
export function homeSections(sessions: readonly Session[], projects: readonly Project[], query: string, pinned: readonly string[] = [], order: "updated_at" | "created_at" = "updated_at") {
  const needle = query.trim().toLowerCase();
  const names = new Map(projects.map((project) => [project.id, project.name.toLowerCase()]));
  const pins = new Set(pinned);
  const matches = needle
    ? sessions.filter((session) => `${session.title} ${names.get(session.projectId) ?? ""} ${session.worktree.branch}`.toLowerCase().includes(needle))
    : [...sessions];
  const settled = matches.filter((session) => !needsYou(session) && !isWorking(session));
  const sort = order === "created_at" ? newestFirst : recentFirst;
  return {
    needsYou: sort(matches.filter(needsYou)),
    working: sort(matches.filter(isWorking)),
    // Pinned conversations come before the rest; what needs the person still comes first.
    pinned: sort(settled.filter((session) => pins.has(session.id))),
    recent: sort(settled.filter((session) => !pins.has(session.id))),
  };
}

/** How far a swiped row stays open: its actions' width once past half of it, else closed. */
export function swipeRest(offset: number, actionsWidth: number): number {
  return offset <= -actionsWidth / 2 ? -actionsWidth : 0;
}

/** Projects with their listed sessions, most recently used first (or by name). */
export function projectGroups(projects: readonly Project[], sessions: readonly Session[], order: "recent" | "name" = "recent") {
  return projects.map((project) => {
    const own = recentFirst(sessions.filter((session) => session.projectId === project.id));
    return {
      project,
      sessions: own,
      needsYou: own.filter(needsYou).length,
      working: own.filter(isWorking).length,
      lastActivityAt: own[0]?.lastActivityAt ?? project.lastOpenedAt,
    };
  }).sort((a, b) => order === "name"
    ? a.project.name.localeCompare(b.project.name, undefined, { numeric: true, sensitivity: "base" })
    : b.lastActivityAt.localeCompare(a.lastActivityAt));
}

/** Short relative time in the person's language: "now", "4 min", "2 h", "3 d". */
export function shortAgo(at: string, locale: string, now = Date.now()): string {
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return "";
  const minutes = Math.max(0, Math.round((now - time) / 60_000));
  const portuguese = locale.startsWith("pt");
  if (minutes < 1) return portuguese ? "agora" : "now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

export type TerminalModifier = "cmd" | "ctrl";
export type TerminalKey =
  | { id: string; label: string; kind: "send"; data: string }
  | { id: TerminalModifier; label: string; kind: "modifier" }
  | { id: "paste"; label: string; kind: "paste" }
  | { id: "clear"; label: string; kind: "clear" };

/**
 * Keys the phone keyboard lacks (ADR-129): CMD and CTRL are sticky
 * (the next key, from this row or the keyboard, gets the modifier), paste reads the clipboard and
 * clear sends Ctrl-L. `label` is shown as is (key caps, never translated).
 */
export const TERMINAL_KEYS: readonly TerminalKey[] = [
  { id: "esc", label: "esc", kind: "send", data: "\u001b" },
  { id: "cmd", label: "CMD", kind: "modifier" },
  { id: "ctrl", label: "CTRL", kind: "modifier" },
  { id: "tab", label: "tab", kind: "send", data: "\t" },
  { id: "paste", label: "paste", kind: "paste" },
  { id: "clear", label: "clear", kind: "clear" },
  { id: "up", label: "↑", kind: "send", data: "\u001b[A" },
  { id: "down", label: "↓", kind: "send", data: "\u001b[B" },
  { id: "left", label: "←", kind: "send", data: "\u001b[D" },
  { id: "right", label: "→", kind: "send", data: "\u001b[C" },
  { id: "pipe", label: "|", kind: "send", data: "|" },
  { id: "tilde", label: "~", kind: "send", data: "~" },
  { id: "slash", label: "/", kind: "send", data: "/" },
];

/** Ctrl-L: the shell redraws an empty screen. */
export const TERMINAL_CLEAR = "\u000c";


/**
 * The bytes a key sends with an armed modifier. CTRL turns a letter into its control
 * character (Ctrl-C → 0x03) and marks arrows (word jumps in most shells); CMD follows macOS
 * terminals' line editing: ← and → go to the line's start and end, delete clears to its start
 * and K clears the screen. Anything without a meaning passes unchanged.
 */
export function withTerminalModifier(data: string, modifier: TerminalModifier | null): string {
  if (!modifier) return data;
  // An arrow key is ESC [ A–D.
  const arrow = data.length === 3 && data.startsWith("\u001b[") && "ABCD".includes(data[2]) ? data[2] : null;
  if (modifier === "ctrl") {
    if (arrow) return `\u001b[1;5${arrow}`;
    if (data.length !== 1) return data;
    const code = data.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) return String.fromCharCode(code - 64);
    if (data === " " || data === "2") return "\u0000";
    if (data === "-" || data === "/") return "\u001f";
    if (data === "?") return "\u007f";
    return data;
  }
  if (arrow === "D") return "\u0001";
  if (arrow === "C") return "\u0005";
  if (data === "\u007f" || data === "\b") return "\u0015";
  if (data === "k" || data === "K") return TERMINAL_CLEAR;
  return data;
}

/** Pages that rise from the bottom as sheets instead of sliding in from the side. */
export function isSheet(screen: MobileScreen): boolean {
  return screen.kind === "new" || screen.kind === "choose-project" || screen.kind === "add-project" || screen.kind === "settings";
}

/** Folders first, then files, each in natural order. */
export function sortEntries(entries: readonly FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}
