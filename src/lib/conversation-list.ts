import type { AppSettings, Project, Session } from "@/client/types";
import { isAuxiliarySession } from "./pull-ask";
import { isSnoozed } from "./snooze";
import { sessionSortKeys, type SessionOrderOptions, type SessionSortKey } from "./sidebar-layout";

/**
 * The conversation list sidebar (ADR-139): recent conversations across every project, flat
 * by last activity or grouped by project. Pure helpers, so ordering and windowing are tested
 * without a renderer.
 */
export type ConversationListOrder = AppSettings["sidebarListOrder"];

/** The settings the list reads (so the sidebar can select just these fields). */
export type ConversationListSettings = Pick<AppSettings, "archivedSessionIds" | "pinnedSessionIds" | "sidebarAttentionFirst" | "sidebarThreadSortOrder">;

export type ConversationListItem =
  | { kind: "project"; key: string; project: Project; count: number }
  | { kind: "session"; key: string; session: Session; project: Project; pinned: boolean };

/** Default, narrowest and widest list column (px); the column is resizable within these. */
export const CONVERSATION_LIST_WIDTH = 280;
export const CONVERSATION_LIST_MIN_WIDTH = 264;
export const CONVERSATION_LIST_MAX_WIDTH = 420;

export function clampConversationListWidth(width: number): number {
  return Math.min(CONVERSATION_LIST_MAX_WIDTH, Math.max(CONVERSATION_LIST_MIN_WIDTH, Math.round(width)));
}

/**
 * Conversations the list shows: those of a saved project that are not archived, snoozed,
 * a side chat or an Ask conversation, and not a team worker whose coordinator is listed
 * (workers are reached from the coordinator's Team panel).
 */
export function listedConversations(projects: readonly Project[], sessions: readonly Session[], settings: Pick<AppSettings, "archivedSessionIds">): Session[] {
  const owned = new Set(projects.map(project => project.id));
  const archived = new Set(settings.archivedSessionIds);
  const shown = sessions.filter(session => owned.has(session.projectId) && !archived.has(session.id) && !isAuxiliarySession(session) && !isSnoozed(session));
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

/**
 * Rows of the list. "recent": pinned conversations first (in pin order), then the rest by
 * attention rank and last activity. "project": one header per project that has conversations,
 * projects ordered by their most recent conversation, each with its pinned ones first.
 */
export function conversationListItems(projects: readonly Project[], sessions: readonly Session[], settings: ConversationListSettings, order: ConversationListOrder, options: SessionOrderOptions = {}): ConversationListItem[] {
  const byId = new Map(projects.map(project => [project.id, project]));
  const listed = listedConversations(projects, sessions, settings);
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
  const row = (session: Session): ConversationListItem => ({ kind: "session", key: session.id, session, project: byId.get(session.projectId)!, pinned: pinOrder.has(session.id) });
  if (order === "recent") return sorted.map(row);
  // Groups follow the most recent unpinned activity, so a pin does not drag its project up.
  const groups = new Map<string, Session[]>();
  for (const session of [...sorted].sort((a, b) => Number(pinOrder.has(a.id)) - Number(pinOrder.has(b.id)))) {
    const group = groups.get(session.projectId);
    if (group) group.push(session); else groups.set(session.projectId, [session]);
  }
  const items: ConversationListItem[] = [];
  for (const [projectId, members] of groups) {
    const project = byId.get(projectId)!;
    items.push({ kind: "project", key: `project:${projectId}`, project, count: members.length });
    for (const session of [...members].sort(compare)) items.push(row(session));
  }
  return items;
}

/** Top offset of every item plus the total height (length n + 1), for two fixed row heights. */
export function itemOffsets(kinds: readonly ConversationListItem["kind"][], rowHeight: number, headerHeight: number): number[] {
  const offsets = new Array<number>(kinds.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < kinds.length; index += 1) offsets[index + 1] = offsets[index] + (kinds[index] === "project" ? headerHeight : rowHeight);
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
