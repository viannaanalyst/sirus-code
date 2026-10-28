import type { AppSettings, Project, Session } from "@/client/types";
import { tabStatus } from "./header-tabs";

/** Everything that places a session in an activity-sorted list, as plain numbers (ADR-121). */
export interface SessionSortKey { rank: number; time: number }

/**
 * What the session order reads beyond the sessions themselves: the unread and computer-use
 * waiting sets (for "Working and unread first") and keys held while the pointer is over the
 * list, so rows keep their place until it leaves.
 */
export interface SessionOrderOptions {
  unseen?: ReadonlySet<string>;
  computer?: ReadonlySet<string>;
  held?: ReadonlyMap<string, SessionSortKey>;
}

/** Waiting and working sessions rank 2, finished-unread ones 1, the rest 0 (only with the setting on). */
export function sessionAttentionRank(session: Session, unseen: ReadonlySet<string> = new Set(), computer: ReadonlySet<string> = new Set()): number {
  const status = tabStatus(session, unseen, computer);
  return status === "waiting" || status === "running" ? 2 : status === "done" ? 1 : 0;
}

export function sessionSortKeys(sessions: readonly Session[], settings: Pick<AppSettings, "sidebarAttentionFirst" | "sidebarThreadSortOrder">, options: Pick<SessionOrderOptions, "unseen" | "computer"> = {}): Map<string, SessionSortKey> {
  return new Map(sessions.map(row => [row.id, {
    rank: settings.sidebarAttentionFirst ? sessionAttentionRank(row, options.unseen, options.computer) : 0,
    time: timestamp(settings.sidebarThreadSortOrder === "updated_at" ? row.lastActivityAt : row.createdAt),
  }]));
}

/** The order settings a held snapshot belongs to; changing them applies at once, even mid-hover. */
export function sessionOrderSignature(settings: Pick<AppSettings, "sidebarAttentionFirst" | "sidebarThreadSortOrder">): string {
  return `${settings.sidebarThreadSortOrder}:${settings.sidebarAttentionFirst}`;
}

export interface SessionOrderSnapshot { signature: string; keys: ReadonlyMap<string, SessionSortKey> }

/**
 * While `hold` is on (the pointer is over the list) the earlier snapshot stays, so no row moves
 * between aiming at it and clicking it; sessions it does not know still slot in by their live
 * key. Without the hold, or after the order settings changed, the live snapshot wins.
 */
export function holdSessionOrder(held: SessionOrderSnapshot | null, live: SessionOrderSnapshot, hold: boolean): SessionOrderSnapshot {
  return hold && held && held.signature === live.signature ? held : live;
}

/** Projects in sidebar order: pinned first, then newest (created_at) or the manual order. */
export function orderSidebarProjects(projects: readonly Project[], settings: Pick<AppSettings, "pinnedProjectIds" | "sidebarProjectOrder" | "sidebarProjectSortOrder">): Project[] {
  const pinnedProjects = new Set(settings.pinnedProjectIds);
  const manualOrder = new Map(settings.sidebarProjectOrder.map((id, index) => [id, index]));
  const fallbackOrder = new Map([...settings.pinnedProjectIds, ...projects.filter(row => !pinnedProjects.has(row.id)).map(row => row.id)].map((id, index) => [id, index]));
  const projectDates = new Map(projects.map(row => [row.id, timestamp(row.addedAt)]));
  return [...projects].sort((a, b) => Number(pinnedProjects.has(b.id)) - Number(pinnedProjects.has(a.id))
    || (settings.sidebarProjectSortOrder === "created_at" ? (projectDates.get(b.id) ?? 0) - (projectDates.get(a.id) ?? 0) : 0)
    || (manualOrder.get(a.id) ?? settings.sidebarProjectOrder.length + (fallbackOrder.get(a.id) ?? projects.length))
    - (manualOrder.get(b.id) ?? settings.sidebarProjectOrder.length + (fallbackOrder.get(b.id) ?? projects.length)));
}

export function sidebarGroups(projects: readonly Project[], sessions: readonly Session[], settings: AppSettings, options: SessionOrderOptions = {}) {
  const pinnedIds = new Set(settings.pinnedSessionIds);
  const sessionOrder = new Map(settings.pinnedSessionIds.map((id, index) => [id, index]));
  const owned = new Set(projects.map((project) => project.id));
  const visible = sessions.filter((session) => owned.has(session.projectId));
  const liveKeys = sessionSortKeys(sessions, settings, options);
  const keyOf = (id: string) => options.held?.get(id) ?? liveKeys.get(id) ?? { rank: 0, time: 0 };
  const originalSessionOrder = new Map(sessions.map((row, index) => [row.id, index]));
  const compareSessions = (a: Session, b: Session) => keyOf(b.id).rank - keyOf(a.id).rank || keyOf(b.id).time - keyOf(a.id).time
    || (originalSessionOrder.get(a.id) ?? 0) - (originalSessionOrder.get(b.id) ?? 0);
  return {
    projects: orderSidebarProjects(projects, settings),
    pinned: visible.filter((session) => pinnedIds.has(session.id)).sort((a, b) => (sessionOrder.get(a.id) ?? 0) - (sessionOrder.get(b.id) ?? 0)),
    nested: visible.filter((session) => !pinnedIds.has(session.id)).sort(compareSessions),
  };
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toggleSidebarId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [id, ...ids].slice(0, 4096);
}

export function pruneSidebarSettings(settings: AppSettings, projects: readonly Project[], sessions: readonly Session[]): AppSettings {
  const projectIds = new Set(projects.map((row) => row.id));
  const sessionIds = new Set(sessions.filter((row) => projectIds.has(row.projectId)).map((row) => row.id));
  return { ...settings, sidebarProjectOrder: settings.sidebarProjectOrder.filter((id) => projectIds.has(id)), pinnedProjectIds: settings.pinnedProjectIds.filter((id) => projectIds.has(id)), pinnedSessionIds: settings.pinnedSessionIds.filter((id) => sessionIds.has(id)) };
}


/** Move one owned folder without changing its pin or project/session metadata. */
export function moveSidebarProject(projects: readonly Project[], settings: AppSettings, id: string, targetId: string, edge: "before" | "after", sessions: readonly Session[] = []): AppSettings {
  const ordered = sidebarGroups(projects, sessions, settings).projects.map(row => row.id);
  if (id === targetId || !ordered.includes(id) || !ordered.includes(targetId)
    || settings.pinnedProjectIds.includes(id) !== settings.pinnedProjectIds.includes(targetId)) return settings;
  const next = ordered.filter(value => value !== id);
  next.splice(next.indexOf(targetId) + (edge === "after" ? 1 : 0), 0, id);
  if (settings.sidebarProjectSortOrder === "manual" && next.every((value, index) => value === ordered[index])) return settings;
  return { ...settings, sidebarProjectSortOrder: "manual", sidebarProjectOrder: next.slice(0, 4096) };
}
