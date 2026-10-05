import type { AppSettings, Project, Session } from "@/client/types";

export function sidebarGroups(projects: readonly Project[], sessions: readonly Session[], settings: AppSettings) {
  const archivedIds = new Set(settings.archivedSessionIds);
  const pinnedIds = new Set(settings.pinnedSessionIds);
  const pinnedProjects = new Set(settings.pinnedProjectIds);
  const manualOrder = new Map(settings.sidebarProjectOrder.map((id, index) => [id, index]));
  const fallbackOrder = new Map([...settings.pinnedProjectIds, ...projects.filter(row => !pinnedProjects.has(row.id)).map(row => row.id)].map((id, index) => [id, index]));
  const sessionOrder = new Map(settings.pinnedSessionIds.map((id, index) => [id, index]));
  const owned = new Set(projects.map((project) => project.id));
  const visible = sessions.filter((session) => owned.has(session.projectId) && !archivedIds.has(session.id));
  const projectDates = new Map(projects.map(row => [row.id, timestamp(row.addedAt)]));
  const sessionDates = new Map(sessions.map(row => [row.id, timestamp(settings.sidebarThreadSortOrder === "updated_at" ? row.lastActivityAt : row.createdAt)]));
  const originalSessionOrder = new Map(sessions.map((row, index) => [row.id, index]));
  const compareSessions = (a: Session, b: Session) => (sessionDates.get(b.id) ?? 0) - (sessionDates.get(a.id) ?? 0)
    || (originalSessionOrder.get(a.id) ?? 0) - (originalSessionOrder.get(b.id) ?? 0);
  return {
    projects: [...projects].sort((a, b) => Number(pinnedProjects.has(b.id)) - Number(pinnedProjects.has(a.id))
      || (settings.sidebarProjectSortOrder === "created_at" ? (projectDates.get(b.id) ?? 0) - (projectDates.get(a.id) ?? 0) : 0)
      || (manualOrder.get(a.id) ?? settings.sidebarProjectOrder.length + (fallbackOrder.get(a.id) ?? projects.length))
      - (manualOrder.get(b.id) ?? settings.sidebarProjectOrder.length + (fallbackOrder.get(b.id) ?? projects.length))),
    pinned: visible.filter((session) => pinnedIds.has(session.id)).sort((a, b) => (sessionOrder.get(a.id) ?? 0) - (sessionOrder.get(b.id) ?? 0)),
    nested: visible.filter((session) => !pinnedIds.has(session.id)).sort(compareSessions),
    archived: sessions.filter((session) => owned.has(session.projectId) && archivedIds.has(session.id)).sort(compareSessions),
  };
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toggleSidebarId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [id, ...ids].slice(0, 4096);
}

export function archiveSidebarSession(settings: AppSettings, id: string): AppSettings {
  return { ...settings, archivedSessionIds: toggleSidebarId(settings.archivedSessionIds, id), pinnedSessionIds: settings.pinnedSessionIds.filter((value) => value !== id) };
}

export function pruneSidebarSettings(settings: AppSettings, projects: readonly Project[], sessions: readonly Session[]): AppSettings {
  const projectIds = new Set(projects.map((row) => row.id));
  const sessionIds = new Set(sessions.filter((row) => projectIds.has(row.projectId)).map((row) => row.id));
  return { ...settings, sidebarProjectOrder: settings.sidebarProjectOrder.filter((id) => projectIds.has(id)), pinnedProjectIds: settings.pinnedProjectIds.filter((id) => projectIds.has(id)), pinnedSessionIds: settings.pinnedSessionIds.filter((id) => sessionIds.has(id) && !settings.archivedSessionIds.includes(id)), archivedSessionIds: settings.archivedSessionIds.filter((id) => sessionIds.has(id)), doneSessions: settings.doneSessions.filter((row) => sessionIds.has(row.id)) };
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

/** Marks a session Done at `at`, or clears the mark when `at` is null (Activity view). */
export function toggleSessionDone(settings: AppSettings, id: string, at: Date | null): AppSettings {
  const rest = settings.doneSessions.filter((row) => row.id !== id);
  return { ...settings, doneSessions: at ? [...rest, { id, at: at.toISOString() }] : rest };
}
