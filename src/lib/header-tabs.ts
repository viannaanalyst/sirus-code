import type { Session } from "@/client/types";

/** Open header tabs per project. Tabs are a view over sessions: closing one never touches the session. */
export const TAB_LIMIT = 12;
export const VISIBLE_TABS = 8;

export type TabStatus = "running" | "waiting" | "done" | "idle";

export function openTab(tabs: readonly string[], sessionId: string, keep: string | null = sessionId): string[] {
  if (tabs.includes(sessionId)) return [...tabs];
  const next = [...tabs, sessionId];
  // Drop the oldest tab that is not the one being kept active.
  while (next.length > TAB_LIMIT) next.splice(next.findIndex(id => id !== keep), 1);
  return next;
}

/** Removes a tab and names the neighbour that should become active (right, else left). */
export function closeTab(tabs: readonly string[], sessionId: string): { tabs: string[]; neighbor: string | null; index: number } {
  const index = tabs.indexOf(sessionId);
  if (index < 0) return { tabs: [...tabs], neighbor: null, index: -1 };
  const next = tabs.filter(id => id !== sessionId);
  return { tabs: next, neighbor: next[Math.min(index, next.length - 1)] ?? null, index };
}

export function moveTab(tabs: readonly string[], sessionId: string, targetId: string, edge?: "before" | "after"): string[] {
  const from = tabs.indexOf(sessionId), to = tabs.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return [...tabs];
  if (edge) {
    const rest = tabs.filter(id => id !== sessionId);
    rest.splice(rest.indexOf(targetId) + (edge === "after" ? 1 : 0), 0, sessionId);
    return rest;
  }
  const next = [...tabs];
  next.splice(from, 1);
  next.splice(to, 0, sessionId);
  return next;
}

/** Only owned, unarchived sessions of the project are shown. */
export function visibleTabSessions(tabs: readonly string[], sessions: readonly Session[], projectId: string, archived: readonly string[]): Session[] {
  const hidden = new Set(archived);
  return tabs.flatMap(id => sessions.find(session => session.id === id && session.projectId === projectId && !hidden.has(id)) ?? []);
}

export function tabStatus(session: Session, unseen: ReadonlySet<string>, computerWaiting: ReadonlySet<string> = new Set()): TabStatus {
  if (session.status === "waiting" || (session.pendingRequests?.length ?? 0) > 0 || computerWaiting.has(session.id)) return "waiting";
  if (session.status === "running" || session.status === "starting") return "running";
  return unseen.has(session.id) ? "done" : "idle";
}

/** A project's strongest signal: waiting beats running beats done. */
export function projectStatus(projectId: string, sessions: readonly Session[], unseen: ReadonlySet<string>, computerWaiting: ReadonlySet<string> = new Set()): TabStatus {
  const order: TabStatus[] = ["waiting", "running", "done"];
  const statuses = new Set(sessions.filter(session => session.projectId === projectId).map(session => tabStatus(session, unseen, computerWaiting)));
  return order.find(status => statuses.has(status)) ?? "idle";
}

/** Sessions that finished while the person was looking elsewhere. */
export function finishedUnseen(previous: ReadonlyMap<string, Session["status"]>, sessions: readonly Session[], selectedSessionId: string | null): string[] {
  return sessions
    .filter(session => session.id !== selectedSessionId)
    .filter(session => ["starting", "running", "waiting"].includes(previous.get(session.id) ?? "") && ["completed", "idle"].includes(session.status))
    .map(session => session.id);
}

/** Window event whose `detail` is the session whose header tab ⌘W closes. */
export const CLOSE_HEADER_TAB = "sirus:close-header-tab";

export type CloseTarget = { kind: "dock"; paneId: string } | { kind: "session"; projectId: string; sessionId: string } | { kind: "draft"; projectId: string };

/**
 * What ⌘W closes, like a browser tab: the active right-panel pane when focus is inside the
 * panel, else the open conversation's header tab, else the blank tab when another tab can take
 * its place. `null` leaves the key to the window's own Close.
 */
export function closeTarget(state: { dockActivePaneId: string | null; inDock: boolean; showTabs: boolean; onSession: boolean; projectId: string | null; sessionId: string | null; tabs: readonly string[]; draft: boolean }): CloseTarget | null {
  if (state.inDock && state.dockActivePaneId) return { kind: "dock", paneId: state.dockActivePaneId };
  if (!state.showTabs || !state.onSession || !state.projectId) return null;
  if (state.sessionId) return state.tabs.includes(state.sessionId) ? { kind: "session", projectId: state.projectId, sessionId: state.sessionId } : null;
  return state.draft && state.tabs.length > 0 ? { kind: "draft", projectId: state.projectId } : null;
}
