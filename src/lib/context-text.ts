import type { Project, Session } from "@/client/types";

/** Matches Synara's text bound and native UTF-16 validation. */
export const CONTEXT_TEXT_LIMIT = 16_384;
export function hasContextOwner(key: string, projects: readonly Project[], sessions: readonly Session[]): boolean {
  if (key.length > 256) return false;
  if (key.startsWith("project:")) return projects.some(row => `project:${row.id}` === key);
  return key.startsWith("session:") && sessions.some(row => `session:${row.id}` === key && projects.some(project => project.id === row.projectId));
}
export function normalizeContextTexts(values: Record<string, string> | undefined, projects: readonly Project[], sessions: readonly Session[]): Record<string, string> {
  return Object.fromEntries(Object.entries(values ?? {}).filter(([key, value]) => hasContextOwner(key, projects, sessions) && typeof value === "string" && value.length > 0 && value.length <= CONTEXT_TEXT_LIMIT));
}
export function pinnedContextMessages(session: Session) {
  const messages = new Map(session.messages.filter(row => row.sessionId === session.id && row.role === "agent" && !row.streaming && row.content.trim()).map(row => [row.id, row]));
  return [...new Set(session.pinnedMessageIds ?? [])].flatMap(id => { const message = messages.get(id); return message ? [message] : []; });
}
