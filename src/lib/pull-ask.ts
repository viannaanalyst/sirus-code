import type { GithubItem, PullAskContext, Session } from "@/client/types";

/** The description travels as a bounded excerpt (native keeps at most 4,000 characters). */
export const PULL_ASK_DESCRIPTION_LIMIT = 4000;
export const PULL_ASK_MIN_WIDTH = 340;
export const PULL_ASK_DEFAULT_WIDTH = 420;

/**
 * Side chats (ADR-049) and pull request Ask conversations (ADR-050) live beside what
 * they answer about and are never listed with the other conversations.
 */
export function isAuxiliarySession(session: Pick<Session, "sideChat" | "pullAsk">): boolean {
  return Boolean(session.sideChat || session.pullAsk);
}

/** `owner/repo#n`, the same key the Pull requests page uses for its items. */
export function pullAskKey(origin: { repository: string; number: number }): string {
  return `${origin.repository}#${origin.number}`;
}

/** The item's Ask conversation, matched like GitHub matches repository names (case-insensitive). */
export function findPullAsk<T extends Pick<Session, "pullAsk">>(sessions: readonly T[], repository: string, number: number): T | null {
  const wanted = repository.toLowerCase();
  return sessions.find((session) => session.pullAsk?.number === number && session.pullAsk.repository.toLowerCase() === wanted) ?? null;
}

/** What the detail shows about the item, as the context Ask wraps around every message. */
export function pullAskContext(item: GithubItem, body: string): PullAskContext {
  const state = item.kind === "pullRequest" && item.state === "open" && item.isDraft ? "draft" : item.state;
  return {
    title: item.title,
    state,
    author: item.author,
    headRef: item.kind === "pullRequest" ? item.headRef : null,
    baseRef: item.kind === "pullRequest" ? item.baseRef : null,
    description: Array.from(body.trim()).slice(0, PULL_ASK_DESCRIPTION_LIMIT).join(""),
  };
}

/** Panel width: at least the minimum, and never so wide that the detail beside it disappears. */
export function clampPullAskWidth(width: number, available: number): number {
  const max = Math.max(PULL_ASK_MIN_WIDTH, Math.floor(available * 0.6));
  return Math.round(Math.min(max, Math.max(PULL_ASK_MIN_WIDTH, width)));
}
