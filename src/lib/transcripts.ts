import type { Message, Session, SessionStatus } from "@/client/types";
import { reuseMessages } from "@/lib/agent-events";

/**
 * Transcripts are loaded per session (ADR-048). Besides these recent ones, the
 * selected, active, queued and explicitly retained sessions always stay loaded.
 */
export const TRANSCRIPT_CACHE = 8;
/**
 * Estimated bytes the recent (not in use) transcripts may hold together, after
 * MonoCode's session cache: a few huge transcripts release the older ones early.
 */
export const TRANSCRIPT_BUDGET = 32 * 1024 * 1024;

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

const messageSizes = new WeakMap<Message, number>();
const length = (text: string | null | undefined) => text ? text.length * 2 : 0;
/**
 * Rough bytes a message holds (UTF-16 text of its content, activity details,
 * outputs, review diffs, steers and attachments), cached per message object:
 * unchanged messages keep their identity across updates, so only new ones are counted.
 */
export function estimateMessageBytes(message: Message): number {
  let size = messageSizes.get(message);
  if (size !== undefined) return size;
  size = 64 + length(message.content);
  for (const item of message.activity?.items ?? []) {
    size += 48 + length(item.label) + length(item.detail) + length(item.output);
    for (const step of item.steps ?? []) size += 32 + length(step.label);
  }
  for (const file of message.activity?.review?.files ?? []) size += 48 + length(file.path) + length(file.diff);
  for (const steer of message.steers ?? []) size += 32 + length(steer.text);
  for (const file of message.attachments ?? []) size += 48 + length(file.name) + length(file.thumbnail);
  messageSizes.set(message, size);
  return size;
}

/** Rough bytes a loaded transcript holds; cheap after the first call per message. */
export function estimateTranscriptBytes(messages: Message[]): number {
  let size = 0;
  for (const message of messages) size += estimateMessageBytes(message);
  return size;
}

/**
 * Loaded transcripts to keep; the others are released from memory. The selected,
 * active, queued and retained ones always stay. Of the `limit` most recently
 * opened, the others stay while everything kept fits `budget` estimated bytes
 * (newest first; one that alone would exceed it is never kept).
 */
export function transcriptsToKeep(input: {
  loaded: Record<string, number>;
  sessions: Session[];
  selectedSessionId: string | null;
  queued: Iterable<string>;
  retained: Iterable<string>;
  limit?: number;
  budget?: number;
}): Set<string> {
  const keep = new Set<string>([...input.queued, ...input.retained]);
  if (input.selectedSessionId) keep.add(input.selectedSessionId);
  for (const session of input.sessions) if (ACTIVE.includes(session.status)) keep.add(session.id);
  const byId = new Map(input.sessions.map((session) => [session.id, session]));
  const budget = input.budget ?? TRANSCRIPT_BUDGET;
  let used = 0;
  for (const id of keep) if (input.loaded[id] !== undefined) used += estimateTranscriptBytes(byId.get(id)?.messages ?? []);
  let room = input.limit ?? TRANSCRIPT_CACHE;
  // As before the budget, in-use transcripts among the most recent take their place in `limit`.
  for (const [id] of Object.entries(input.loaded).sort((a, b) => b[1] - a[1])) {
    if (room <= 0) break;
    room -= 1;
    if (keep.has(id)) continue;
    const size = estimateTranscriptBytes(byId.get(id)?.messages ?? []);
    if (used + size > budget) continue;
    used += size;
    keep.add(id);
  }
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
