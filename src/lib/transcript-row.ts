import type { Message, Session } from "@/client/types";

/** What a transcript row receives; `last` marks the conversation's final message. */
export interface TranscriptRowProps {
  message: Message;
  session: Session;
  searchQuery: string;
  nodes: unknown;
  compacted?: boolean;
  last?: boolean;
}

/**
 * The store builds a new session object on every streamed frame (and native events
 * rebuild its nested objects), so a row compares only the session fields it and
 * its children read: identity alone would re-render every row each frame.
 */
export function sameRowSession(a: Session, b: Session, messageId: string): boolean {
  if (a === b) return true;
  return a.id === b.id && a.status === b.status && a.agent === b.agent && a.model === b.model
    && a.pinnedMessageIds === b.pinnedMessageIds && a.astro === b.astro && a.worktree.path === b.worktree.path
    && (a.sideChat?.parentSessionId ?? null) === (b.sideChat?.parentSessionId ?? null)
    && a.execution?.approval === b.execution?.approval
    && a.team?.messageId === b.team?.messageId
    // Only the coordinator's own row shows the team panel, which reads the whole team.
    && (a.team?.messageId !== messageId || a.team === b.team);
}

/** `memo` compare for a transcript row: re-render only when something it shows changed. */
export function sameRowProps(previous: TranscriptRowProps, next: TranscriptRowProps): boolean {
  return previous.message === next.message && previous.compacted === next.compacted && previous.last === next.last
    && previous.searchQuery === next.searchQuery && previous.nodes === next.nodes
    && sameRowSession(previous.session, next.session, next.message.id);
}
