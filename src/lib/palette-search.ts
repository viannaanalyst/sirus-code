import type { Session } from "@/client/types";
import { searchConversations, type SearchHit } from "./conversation-search";

/** Message search in the palette starts at this many characters, so one letter does not scan every transcript. */
export const PALETTE_MESSAGE_QUERY = 3;

/**
 * How well a chat title answers the query; lower is better, `null` is no match. The whole
 * title, then its start, then a word start, then anywhere, then every word of the query
 * somewhere in the title in any order.
 */
export function titleRank(title: string, query: string): number | null {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return 4;
  const text = title.toLocaleLowerCase();
  if (text === needle) return 0;
  if (text.startsWith(needle)) return 1;
  const at = text.indexOf(needle);
  if (at > 0 && !/[\p{L}\p{N}]/u.test(text[at - 1])) return 2;
  if (at >= 0) return 3;
  const words = needle.split(/\s+/);
  return words.length > 1 && words.every(word => text.includes(word)) ? 4 : null;
}

/** Title matches, best first and then most recent. */
export function rankChats<T extends Pick<Session, "title" | "lastActivityAt">>(sessions: T[], query: string, limit: number): T[] {
  return sessions.flatMap(session => { const rank = titleRank(session.title, query); return rank === null ? [] : [{ session, rank }]; })
    .sort((a, b) => a.rank - b.rank || b.session.lastActivityAt.localeCompare(a.session.lastActivityAt))
    .slice(0, limit)
    .map(entry => entry.session);
}

/**
 * One hit per conversation whose messages match, skipping `exclude` (chats already listed by
 * title): the most recent conversation first, each with its latest matching message.
 */
export function messageMatches(sessions: Session[], query: string, exclude: ReadonlySet<string>, limit: number): { session: Session; hit: SearchHit; count: number }[] {
  const out: { session: Session; hit: SearchHit; count: number }[] = [];
  const ordered = sessions.filter(session => !exclude.has(session.id)).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  for (const session of ordered) {
    const { hits } = searchConversations([session], query);
    if (!hits.length) continue;
    out.push({ session, hit: hits[hits.length - 1], count: hits.length });
    if (out.length >= limit) break;
  }
  return out;
}
