import type { Message, Session, SessionStatus } from "@/client/types";
import { reuseMessages } from "@/lib/agent-events";

/**
 * Transcripts are loaded per session (ADR-048). Besides these recent ones, the
 * selected, active, queued and explicitly retained sessions always stay loaded.
 */
export const TRANSCRIPT_CACHE = 8;

const ACTIVE: SessionStatus[] = ["starting", "running", "waiting"];

/** Whether a session has user/assistant messages, loaded or not. */
export function hasConversation(session: Session) {
  return session.messages.some((message) => message.role !== "system") || (session.transcriptLength ?? 0) > 0;
}

/**
 * Applies a native session event. Events carry `messages[from..]` of `total`;
 * a loaded transcript is spliced, an unloaded one keeps only metadata. `reload`
 * asks for a fresh transcript when the held copy cannot be spliced safely.
 */
export function mergeSessionEvent(current: Session | undefined, event: Session, loaded: boolean): { session: Session; reload: boolean } {
  const { transcriptWindow: window, ...rest } = event;
  const pinnedMessageIds = current?.pinnedMessageIds ?? event.pinnedMessageIds;
  const held = current?.messages ?? [];
  if (!window) return { session: { ...rest, pinnedMessageIds, messages: reuseMessages(held, keepSentOutputs(held, event.messages)) }, reload: false };
  if (!loaded) return { session: { ...rest, pinnedMessageIds, messages: held }, reload: false };
  const consistent = window.from + event.messages.length === window.total;
  if (held.length < window.from || !consistent) return { session: { ...rest, pinnedMessageIds, messages: held }, reload: true };
  return { session: { ...rest, pinnedMessageIds, messages: reuseMessages(held, [...held.slice(0, window.from), ...keepSentOutputs(held, event.messages)]) }, reload: false };
}

/**
 * Live events send a command row's output only when it changes (a busy turn's
 * outputs are most of its bytes). A command row without `output` keeps the one
 * already held; natively a command's output never returns to empty.
 */
export function keepSentOutputs(held: Message[], incoming: Message[]): Message[] {
  let byId: Map<string, Message> | null = null;
  return incoming.map((message) => {
    const items = message.activity?.items;
    if (!items?.some((item) => item.kind === "command" && item.output === undefined)) return message;
    byId ??= new Map(held.map((each) => [each.id, each]));
    const previous = byId.get(message.id)?.activity?.items;
    if (!previous?.length) return message;
    const outputs = new Map(previous.filter((item) => item.output).map((item) => [item.id, item.output]));
    if (!outputs.size) return message;
    return {
      ...message,
      activity: { ...message.activity!, items: items.map((item) => item.kind === "command" && item.output === undefined && outputs.has(item.id) ? { ...item, output: outputs.get(item.id) } : item) },
    };
  });
}

/** Loaded transcripts to keep; the others are released from memory. */
export function transcriptsToKeep(input: {
  loaded: Record<string, number>;
  sessions: Session[];
  selectedSessionId: string | null;
  queued: Iterable<string>;
  retained: Iterable<string>;
  limit?: number;
}): Set<string> {
  const keep = new Set<string>([...input.queued, ...input.retained]);
  if (input.selectedSessionId) keep.add(input.selectedSessionId);
  for (const session of input.sessions) if (ACTIVE.includes(session.status)) keep.add(session.id);
  const recent = Object.entries(input.loaded).sort((a, b) => b[1] - a[1]).slice(0, input.limit ?? TRANSCRIPT_CACHE);
  for (const [id] of recent) keep.add(id);
  return keep;
}

/**
 * A loaded snapshot replaces the held transcript, except where held text already
 * extends it: deltas emitted after the snapshot can arrive before the response.
 */
export function mergeLoadedTranscript(held: Message[], snapshot: Message[]): Message[] {
  if (!held.length) return snapshot;
  const byId = new Map(held.map((message) => [message.id, message]));
  return reuseMessages(held, snapshot.map((message) => {
    const local = byId.get(message.id);
    return local && local.content.length > message.content.length && local.content.startsWith(message.content) ? { ...message, content: local.content } : message;
  }));
}
