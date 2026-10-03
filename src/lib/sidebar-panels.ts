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
    case "select": return { section: event.collapsed ? state.section : event.section, peek: event.collapsed ? event.section : null, revision: state.revision + 1 };
    case "leave": return event.revision === state.revision ? { ...state, peek: null } : state;
    case "pin": return { section: state.peek ?? state.section, peek: null, revision: state.revision + 1 };
    case "dismiss": return { ...state, peek: null, revision: state.revision + 1 };
  }
}

export interface SidebarFeedSection { label: "Pinned" | "Drafts" | "Recent" | "Archived sessions"; sessions: Session[]; }
export function sidebarActivityFeed(projects: readonly Project[], sessions: readonly Session[], settings: AppSettings, drafts: Readonly<Record<string, string>>, options: { projectId?: string | null; query?: string; draftsOnly?: boolean; archived?: boolean } = {}): SidebarFeedSection[] {
  const inventory = sidebarGroups(projects, sessions, settings);
  const projectNames = new Map(projects.map(project => [project.id, project.name]));
  const needle = (options.query ?? "").trim().toLocaleLowerCase();
  const draft = (session: Session) => Boolean(drafts[`session:${session.id}`]?.trim());
  const visible = (session: Session) => (!options.projectId || session.projectId === options.projectId)
    && (!options.draftsOnly || draft(session))
    && (!needle || `${session.title} ${projectNames.get(session.projectId) ?? ""} ${session.worktree.branch}`.toLocaleLowerCase().includes(needle));
  if (options.archived) return [{ label: "Archived sessions", sessions: inventory.archived.filter(visible) }];
  const recent = inventory.nested.filter(visible);
  return [
    { label: "Pinned", sessions: inventory.pinned.filter(visible) },
    { label: "Drafts", sessions: recent.filter(draft) },
    { label: "Recent", sessions: recent.filter(session => !draft(session)) },
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
