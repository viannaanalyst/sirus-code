import type { Automation, GithubInbox, Session } from "@/client/types";
import { involvement } from "@/lib/github-inbox";

export interface InboxGroups {
  needsYou: Session[];
  running: Session[];
  review: Session[];
  failed: Session[];
  reviewRequests: number;
  automationIssues: Automation[];
}

const recent = (list: Session[]) => list.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

/**
 * The Inbox (ADR-052) is derived, never stored: sessions waiting for the
 * person, running ones, finished or failed ones the person has not opened,
 * plus PR review requests and automations that need attention.
 */
export function inboxGroups(sessions: readonly Session[], unseen: readonly string[], archived: readonly string[], pulls: GithubInbox | null | undefined, automations: readonly Automation[] | undefined): InboxGroups {
  const listed = sessions.filter((session) => !session.sideChat && !archived.includes(session.id));
  const unread = new Set(unseen);
  return {
    needsYou: recent(listed.filter((session) => session.status === "waiting")),
    running: recent(listed.filter((session) => session.status === "running" || session.status === "starting")),
    review: recent(listed.filter((session) => session.status === "completed" && unread.has(session.id))),
    failed: recent(listed.filter((session) => (session.status === "failed" || session.status === "stopped") && unread.has(session.id))),
    reviewRequests: pulls ? pulls.items.filter((item) => item.kind === "pullRequest" && item.state === "open" && involvement(item, pulls.viewer).reviewRequested).length : 0,
    automationIssues: (automations ?? []).filter((automation) => automation.lastError),
  };
}

export function needsYouCount(groups: InboxGroups) {
  return groups.needsYou.length + (groups.reviewRequests ? 1 : 0) + (groups.automationIssues.length ? 1 : 0);
}
