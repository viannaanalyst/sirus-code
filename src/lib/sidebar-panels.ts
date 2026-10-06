import type { PullRequestLoadState } from "./pull-requests";
import type { AppSettings, Project, Session, PullRequest } from "@/client/types";
import { sidebarGroups } from "./sidebar-layout";

export const SIDEBAR_RAIL_WIDTH = 52;
/** Default and minimum expanded sidebar width. */
export const SIDEBAR_MIN_WIDTH = 292;
export const SIDEBAR_SECTIONS = ["home", "kanban", "archived"] as const;
export type SidebarSection = typeof SIDEBAR_SECTIONS[number];
export interface SidebarPanelState { section: SidebarSection; peek: SidebarSection | null; revision: number; }
export type SidebarPanelEvent =
  | { type: "peek"; section: SidebarSection }
  | { type: "select"; section: SidebarSection; collapsed: boolean }
  | { type: "leave"; revision: number }
  | { type: "pin" }
  | { type: "dismiss" };
export const initialSidebarPanel: SidebarPanelState = { section: "home", peek: null, revision: 0 };
/** Each close belongs to the preview that scheduled it, not a later icon. */
export function sidebarPanelReducer(state: SidebarPanelState, event: SidebarPanelEvent): SidebarPanelState {
  switch (event.type) {
    case "peek": return { ...state, peek: event.section, revision: state.revision + 1 };
    // A click chooses the section even while collapsed (its panel then floats); hover only previews.
    case "select": return { section: event.section, peek: event.collapsed ? event.section : null, revision: state.revision + 1 };
    case "leave": return event.revision === state.revision ? { ...state, peek: null } : state;
    case "pin": return { section: state.peek ?? state.section, peek: null, revision: state.revision + 1 };
    case "dismiss": return { ...state, peek: null, revision: state.revision + 1 };
  }
}

export interface SidebarFeedSection { label: "Pinned" | "Recent" | "Archived sessions"; sessions: Session[]; }
export function sidebarActivityFeed(projects: readonly Project[], sessions: readonly Session[], settings: AppSettings, options: { projectId?: string | null; query?: string; archived?: boolean } = {}): SidebarFeedSection[] {
  const inventory = sidebarGroups(projects, sessions, settings);
  const projectNames = new Map(projects.map(project => [project.id, project.name]));
  const needle = (options.query ?? "").trim().toLocaleLowerCase();
  const visible = (session: Session) => (!options.projectId || session.projectId === options.projectId)
    && (!needle || `${session.title} ${projectNames.get(session.projectId) ?? ""} ${session.worktree.branch}`.toLocaleLowerCase().includes(needle));
  if (options.archived) return [{ label: "Archived sessions", sessions: inventory.archived.filter(visible) }];
  return [
    { label: "Pinned", sessions: inventory.pinned.filter(visible) },
    { label: "Recent", sessions: inventory.nested.filter(visible) },
  ];
}

/** A row never starts a PR probe or displays a snapshot for a foreign workspace/branch. */
export function sidebarPullRequest(session: Session, cached: PullRequestLoadState | undefined, currentBranch?: string | null): PullRequest | null {
  const snapshot = cached?.snapshot;
  const branch = currentBranch === undefined ? session.worktree.branch : currentBranch;
  if (!cached || cached.loading || cached.error || cached.workspacePath !== session.worktree.path || !snapshot
    || snapshot.sessionId !== session.id || snapshot.status !== "ready" || !branch || snapshot.branch !== branch
    || snapshot.pullRequest?.headBranch !== branch) return null;
  return snapshot.pullRequest;
}

export interface ActivitySection { key: string; label: string; sessions: Session[] }

/** A session marked Done stays done until it has newer activity than the mark. */
export function isSessionDone(session: Session, done: AppSettings["doneSessions"]) {
  const mark = done.find((row) => row.id === session.id);
  if (!mark) return false;
  const markedAt = Date.parse(mark.at), active = Date.parse(session.lastActivityAt);
  return Number.isFinite(markedAt) && (!Number.isFinite(active) || active <= markedAt);
}

/**
 * The sidebar Activity view: pinned first, then sessions that need the person,
 * running ones, the rest by day, and finally the ones marked Done.
 * Each session appears once, in the first section that matches. Labels are i18n keys.
 */
export function sidebarTimeline(projects: readonly Project[], sessions: readonly Session[], settings: AppSettings, now: Date, options: { scope?: string | null } = {}): ActivitySection[] {
  const inventory = sidebarGroups(projects, sessions, settings);
  const inScope = (session: Session) => !options.scope || session.projectId === options.scope;
  const recent = (list: Session[]) => [...list].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  const sections: ActivitySection[] = [{ key: "pinned", label: "Pinned", sessions: inventory.pinned.filter(inScope) }];
  let rest = recent(inventory.nested.filter(inScope));
  const take = (key: string, label: string, match: (session: Session) => boolean) => {
    sections.push({ key, label, sessions: rest.filter(match) });
    rest = rest.filter((session) => !match(session));
  };
  take("waiting", "activity.needsYou", (session) => session.status === "waiting");
  take("running", "activity.working", (session) => session.status === "running" || session.status === "starting");
  const done = rest.filter((session) => isSessionDone(session, settings.doneSessions));
  rest = rest.filter((session) => !done.includes(session));
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const today = day(now), yesterday = today - 86_400_000;
  const started = (session: Session) => { const time = new Date(session.lastActivityAt); return Number.isNaN(time.getTime()) ? 0 : day(time); };
  take("today", "activity.today", (session) => started(session) >= today);
  take("yesterday", "activity.yesterday", (session) => started(session) >= yesterday);
  sections.push({ key: "earlier", label: "activity.earlier", sessions: rest });
  const markedAt = (session: Session) => settings.doneSessions.find((row) => row.id === session.id)?.at ?? "";
  sections.push({ key: "done", label: "activity.done", sessions: done.sort((a, b) => markedAt(b).localeCompare(markedAt(a))) });
  return sections.filter((section) => section.sessions.length > 0);
}
