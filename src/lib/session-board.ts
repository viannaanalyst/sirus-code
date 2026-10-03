import type { Session, SessionStatus } from "@/client/types";

export const SESSION_COLUMNS = [
  { id: "queued", label: "Queued sessions" },
  { id: "active", label: "Active sessions" },
  { id: "waiting", label: "Waiting sessions" },
  { id: "completed", label: "Completed sessions" },
  { id: "interrupted", label: "Interrupted sessions" },
] as const;

/** Compact relative time for Kanban cards (6d, 2h, 5m). */
export function relativeTime(at: string, now = Date.now()): string {
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

type ColumnId = typeof SESSION_COLUMNS[number]["id"];
const statusColumn: Record<SessionStatus, ColumnId> = {
  idle: "queued",
  starting: "active",
  running: "active",
  waiting: "waiting",
  completed: "completed",
  failed: "interrupted",
  stopped: "interrupted",
};

// Presentation only: native events remain the sole authority for lifecycle state.
export function groupProjectSessions(sessions: readonly Session[], projectId: string | null) {
  const groups: Record<ColumnId, Session[]> = { queued: [], active: [], waiting: [], completed: [], interrupted: [] };
  for (const session of sessions) {
    if (session.projectId === projectId) groups[statusColumn[session.status]].push(session);
  }
  for (const group of Object.values(groups)) group.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  return groups;
}
