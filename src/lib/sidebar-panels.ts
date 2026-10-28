import type { PullRequestLoadState } from "./pull-requests";
import type { AppSettings, Project, Session, PullRequest } from "@/client/types";
import { sidebarGroups } from "./sidebar-layout";

export const SIDEBAR_RAIL_WIDTH = 52;
/** Width of the conversation list column (ADR-139; fixed, as `CONVERSATION_LIST_WIDTH`). */
export const SIDEBAR_MIN_WIDTH = 256;
export interface SidebarFeedSection { label: "Pinned" | "Recent"; sessions: Session[]; }
export function sidebarActivityFeed(projects: readonly Project[], sessions: readonly Session[], settings: AppSettings, options: { projectId?: string | null; query?: string } = {}): SidebarFeedSection[] {
  const inventory = sidebarGroups(projects, sessions, settings);
  const projectNames = new Map(projects.map(project => [project.id, project.name]));
  const needle = (options.query ?? "").trim().toLocaleLowerCase();
  const visible = (session: Session) => (!options.projectId || session.projectId === options.projectId)
    && (!needle || `${session.title} ${projectNames.get(session.projectId) ?? ""} ${session.worktree.branch}`.toLocaleLowerCase().includes(needle));
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
