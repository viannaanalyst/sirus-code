import type { AppSettings, Project, Session } from "@/client/types";
import { tabStatus, type TabStatus } from "./header-tabs";
import { isAuxiliarySession } from "./pull-ask";
import { isSnoozed } from "./snooze";
import { sessionSortKeys, type SessionOrderOptions, type SessionSortKey } from "./sidebar-layout";

/**
 * The conversation list sidebar (ADR-139): recent conversations across every project, flat
 * by last activity or in project folders. Pure helpers, so ordering and windowing are tested without a renderer.
 */
export type ConversationListOrder = AppSettings["sidebarListOrder"];

/** The settings the list reads (so the sidebar can select just these fields). */
export type ConversationListSettings = Pick<AppSettings, "pinnedSessionIds" | "sidebarAttentionFirst" | "sidebarThreadSortOrder">;

export type ConversationListItem =
  | { kind: "folder"; key: string; project: Project; count: number; status: TabStatus; open: boolean }
  | { kind: "session"; key: string; session: Session; project: Project; pinned: boolean; nested: boolean }
  /** Under an open folder past `FOLDER_PREVIEW` conversations: Show more (`hidden` > 0) or Show less. */
  | { kind: "more"; key: string; projectId: string; hidden: number };

/** The list style is a column (ADR-139); the rail is 52 px. */
export function isColumnSidebar(mode: AppSettings["sidebarMode"]): boolean {
  return mode === "list";
}

/** Most project folders remembered as open (validated natively too). */
export const SIDEBAR_OPEN_FOLDERS_LIMIT = 100;

/** An open folder shows this many conversations until Show more. */
export const FOLDER_PREVIEW = 5;

/** The list column has one fixed width (px); they are not resizable. */
export const CONVERSATION_LIST_WIDTH = 256;

export function clampConversationListWidth(width: number): number {
  void width;
  return CONVERSATION_LIST_WIDTH;
}

/**
 * Conversations the list shows: those of a saved project that are not snoozed,
 * a side chat or an Ask conversation, and not a team worker whose coordinator is listed
 * (workers are reached from the coordinator's Team panel).
 */
export function listedConversations(projects: readonly Project[], sessions: readonly Session[]): Session[] {
  const owned = new Set(projects.map(project => project.id));
  const shown = sessions.filter(session => owned.has(session.projectId) && !isAuxiliarySession(session) && !isSnoozed(session));
  const ids = new Set(shown.map(session => session.id));
  return shown.filter(session => !session.teamWorker || !ids.has(session.teamWorker.coordinatorSessionId));
}

/** The list always orders by last activity; "Working and unread first" still applies (ADR-121). */
export function conversationOrderSettings(settings: ConversationListSettings): ConversationListSettings {
  return settings.sidebarThreadSortOrder === "updated_at" ? settings : { ...settings, sidebarThreadSortOrder: "updated_at" };
}

/** Sort keys of the listed conversations, as captured before a hold (ADR-121). */
export function conversationSortKeys(sessions: readonly Session[], settings: ConversationListSettings, options: Pick<SessionOrderOptions, "unseen" | "computer"> = {}): Map<string, SessionSortKey> {
  return sessionSortKeys(sessions, conversationOrderSettings(settings), options);
}

/** Options of the list rows: the order inputs plus which project folders are open. */
export interface ConversationListOptions extends SessionOrderOptions {
  openFolders?: ReadonlySet<string>;
  /** Folders showing all their conversations (Show more); the rest show `FOLDER_PREVIEW`. */
  fullFolders?: ReadonlySet<string>;
  /** Shown even past the preview (the selected conversation). */
  keep?: string | null;
}

/**
 * Rows of the list. "recent": pinned conversations first (in pin order), then the rest by
 * attention rank and last activity. "project": one folder per project that has conversations,
 * projects ordered by their most recent conversation; an open folder is followed by its
 * conversations (pinned ones first), marked `nested`: the first `FOLDER_PREVIEW` (plus `keep`)
 * and a Show more row, or all of them and Show less when the folder is in `fullFolders`.
 */
export function conversationListItems(projects: readonly Project[], sessions: readonly Session[], settings: ConversationListSettings, order: ConversationListOrder, options: ConversationListOptions = {}): ConversationListItem[] {
  const byId = new Map(projects.map(project => [project.id, project]));
  const listed = listedConversations(projects, sessions);
  const live = conversationSortKeys(listed, settings, options);
  const keyOf = (id: string) => options.held?.get(id) ?? live.get(id) ?? { rank: 0, time: 0 };
  const pinOrder = new Map(settings.pinnedSessionIds.map((id, index) => [id, index]));
  const position = new Map(listed.map((session, index) => [session.id, index]));
  const compare = (a: Session, b: Session) => {
    const pa = pinOrder.get(a.id), pb = pinOrder.get(b.id);
    if (pa !== undefined || pb !== undefined) return (pa ?? Infinity) - (pb ?? Infinity);
    const ka = keyOf(a.id), kb = keyOf(b.id);
    return kb.rank - ka.rank || kb.time - ka.time || (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0);
  };
  const sorted = [...listed].sort(compare);
  const row = (session: Session, nested = false): ConversationListItem => ({ kind: "session", key: session.id, session, project: byId.get(session.projectId)!, pinned: pinOrder.has(session.id), nested });
  if (order === "recent") return sorted.map(session => row(session));
  // Groups follow the most recent unpinned activity, so a pin does not drag its project up.
  const groups = new Map<string, Session[]>();
  for (const session of [...sorted].sort((a, b) => Number(pinOrder.has(a.id)) - Number(pinOrder.has(b.id)))) {
    const group = groups.get(session.projectId);
    if (group) group.push(session); else groups.set(session.projectId, [session]);
  }
  const items: ConversationListItem[] = [];
  for (const [projectId, members] of groups) {
    const project = byId.get(projectId)!;
    const open = options.openFolders?.has(projectId) ?? false;
    items.push({ kind: "folder", key: `folder:${projectId}`, project, count: members.length, status: folderStatus(members, options.unseen, options.computer), open });
    if (!open) continue;
    const ordered = [...members].sort(compare);
    const full = options.fullFolders?.has(projectId) ?? false;
    const shown = full || ordered.length <= FOLDER_PREVIEW ? ordered : ordered.filter((session, index) => index < FOLDER_PREVIEW || session.id === options.keep);
    for (const session of shown) items.push(row(session, true));
    if (ordered.length > FOLDER_PREVIEW) items.push({ kind: "more", key: `more:${projectId}`, projectId, hidden: ordered.length - shown.length });
  }
  return items;
}

/** A folder's dot: its most urgent conversation, working before waiting before unread. */
export function folderStatus(sessions: readonly Session[], unseen: ReadonlySet<string> = new Set(), computer: ReadonlySet<string> = new Set()): TabStatus {
  const statuses = new Set(sessions.map(session => tabStatus(session, unseen, computer)));
  return (["running", "waiting", "done"] as const).find(status => statuses.has(status)) ?? "idle";
}

/** Open folders: the saved ones, or (never set) the selected project's. */
export function openFolderIds(saved: readonly string[] | null, selectedProjectId: string | null): string[] {
  return saved ? [...saved] : selectedProjectId ? [selectedProjectId] : [];
}

/** Opens or closes one folder; newly opened ones go first and the list stays bounded. */
export function toggleOpenFolder(open: readonly string[], projectId: string): string[] {
  return open.includes(projectId) ? open.filter(id => id !== projectId) : [projectId, ...open].slice(0, SIDEBAR_OPEN_FOLDERS_LIMIT);
}

/** Opens a folder if it is closed (selecting a conversation shows it); `null` when nothing changes. */
export function expandOpenFolder(open: readonly string[], projectId: string): string[] | null {
  return open.includes(projectId) ? null : toggleOpenFolder(open, projectId);
}

/** Top offset of every item plus the total height (length n + 1): conversation rows and headers (folders, Show more) each have one fixed height. */
export function itemOffsets(kinds: readonly ConversationListItem["kind"][], rowHeight: number, headerHeight: number): number[] {
  const offsets = new Array<number>(kinds.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < kinds.length; index += 1) offsets[index + 1] = offsets[index] + (kinds[index] === "session" ? rowHeight : headerHeight);
  return offsets;
}

/** First and last item to render (end exclusive) for a viewport over `offsets`, with overscan items each side. */
export function offsetWindow(offsets: readonly number[], scrollTop: number, viewport: number, overscan = 12): { start: number; end: number } {
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: 0 };
  // The first item whose bottom is below the top edge, and the first whose top is past the bottom edge.
  const first = lowerBound(offsets, scrollTop, 1) - 1;
  const last = lowerBound(offsets, scrollTop + viewport, 0);
  const start = Math.max(0, Math.min(count - 1, first) - overscan);
  const end = Math.min(count, Math.max(last, first + 1) + overscan);
  return { start: Math.min(start, end), end };
}

/** Smallest index ≥ `from` whose offset is greater than `value` (offsets ascend). */
function lowerBound(offsets: readonly number[], value: number, from: number): number {
  let low = from, high = offsets.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (offsets[middle] > value) high = middle; else low = middle + 1;
  }
  return low;
}
