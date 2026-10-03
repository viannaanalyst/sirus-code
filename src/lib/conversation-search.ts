import type { Message, Session } from "@/client/types";
import { parseTranscript } from "./transcript";

export interface SearchHit { sessionId: string; messageId: string; start: number; end: number; snippet: string }
export interface TranscriptSearch { query: string; scope: "session" | "all"; revision: number }
export function searchableMessageText(message: Pick<Message, "role" | "content">): string {
  return message.role === "agent" ? parseTranscript(message.content).map(block => block.content).join("\n") : message.content;
}
/** Literal Unicode matching; never interpret user text as a regex or HTML. */
export function textMatches(text: string, query: string, limit = 200): { start: number; end: number }[] {
  const needle = query.trim().slice(0, 256);
  if (!needle) return [];
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const hits = [];
  for (const match of text.matchAll(pattern)) {
    hits.push({ start: match.index, end: match.index + match[0].length });
    if (hits.length >= limit) break;
  }
  return hits;
}
export function searchConversations(sessions: Session[], query: string, sessionId?: string): { hits: SearchHit[]; truncated: boolean } {
  const hits: SearchHit[] = [];
  if (!query.trim()) return { hits, truncated: false };
  for (const session of sessions) {
    if (sessionId !== undefined && session.id !== sessionId) continue;
    for (const message of session.messages) {
      if (message.sessionId !== session.id || message.role === "system") continue;
      const text = searchableMessageText(message);
      for (const match of textMatches(text, query, 201 - hits.length)) {
        if (hits.length === 200) return { hits, truncated: true };
        hits.push({ sessionId: session.id, messageId: message.id, ...match, snippet: `${match.start > 45 ? "…" : ""}${text.slice(Math.max(0, match.start - 45), match.end + 75).replace(/\s+/g, " ")}${text.length > match.end + 75 ? "…" : ""}` });
      }
    }
  }
  return { hits, truncated: false };
}
