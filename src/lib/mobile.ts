import type { FileEntry, Project, Session } from "@/client/types";

/**
 * The phone app (ADR-081) is a separate shell over the same store. Its screens form
 * a small stack on top of three tabs; the browser history mirrors the stack so the
 * system back gesture closes the top screen.
 */
export type MobileTab = "home" | "projects" | "astros" | "settings";
export type MobileScreen =
  | { kind: "chat"; sessionId: string }
  | { kind: "new"; projectId: string | null }
  | { kind: "new-astro" }
  | { kind: "archived" }
  | { kind: "git"; sessionId: string }
  | { kind: "files"; sessionId: string }
  | { kind: "project-look"; projectId: string }
  | { kind: "edit-astro"; astroId: string }
  | { kind: "review"; sessionId: string }
  | { kind: "terminal"; sessionId: string };

/** Phones get the phone app; a tablet or a wide window keeps the Mac layout. */
export const MOBILE_QUERY = "(max-width: 820px)";

/** Sessions the person sees in lists: no side chats, Astro chats or archived ones. */
export function listedSessions(sessions: readonly Session[], archived: readonly string[]): Session[] {
  const hidden = new Set(archived);
  return sessions.filter((session) => !session.sideChat && !session.astro && !hidden.has(session.id));
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

const recentFirst = (list: Session[]) => list.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

/** Home: first what needs the person, then what is running, then the rest by recency. */
export function homeSections(sessions: readonly Session[], projects: readonly Project[], query: string, pinned: readonly string[] = []) {
  const needle = query.trim().toLowerCase();
  const names = new Map(projects.map((project) => [project.id, project.name.toLowerCase()]));
  const pins = new Set(pinned);
  const matches = needle
    ? sessions.filter((session) => `${session.title} ${names.get(session.projectId) ?? ""} ${session.worktree.branch}`.toLowerCase().includes(needle))
    : [...sessions];
  const settled = matches.filter((session) => !needsYou(session) && !isWorking(session));
  return {
    needsYou: recentFirst(matches.filter(needsYou)),
    working: recentFirst(matches.filter(isWorking)),
    // Pinned conversations come before the rest; what needs the person still comes first.
    pinned: recentFirst(settled.filter((session) => pins.has(session.id))),
    recent: recentFirst(settled.filter((session) => !pins.has(session.id))),
  };
}

/** How far a swiped row stays open: its actions' width once past half of it, else closed. */
export function swipeRest(offset: number, actionsWidth: number): number {
  return offset <= -actionsWidth / 2 ? -actionsWidth : 0;
}

/** Projects with their listed sessions, most recently used first. */
export function projectGroups(projects: readonly Project[], sessions: readonly Session[]) {
  return projects.map((project) => {
    const own = recentFirst(sessions.filter((session) => session.projectId === project.id));
    return {
      project,
      sessions: own,
      needsYou: own.filter(needsYou).length,
      working: own.filter(isWorking).length,
      lastActivityAt: own[0]?.lastActivityAt ?? project.lastOpenedAt,
    };
  }).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
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

/** Keys the phone keyboard lacks, as the bytes a terminal expects. */
export const TERMINAL_KEYS: readonly { label: string; data: string }[] = [
  { label: "esc", data: "\u001b" },
  { label: "tab", data: "\t" },
  { label: "ctrl-c", data: "\u0003" },
  { label: "↑", data: "\u001b[A" },
  { label: "↓", data: "\u001b[B" },
  { label: "←", data: "\u001b[D" },
  { label: "→", data: "\u001b[C" },
  { label: "|", data: "|" },
  { label: "~", data: "~" },
  { label: "/", data: "/" },
];

/** Pages that rise from the bottom as sheets instead of sliding in from the side. */
export function isSheet(screen: MobileScreen): boolean {
  return screen.kind === "new" || screen.kind === "new-astro" || screen.kind === "edit-astro" || screen.kind === "project-look";
}

/** Folders first, then files, each in natural order. */
export function sortEntries(entries: readonly FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}
