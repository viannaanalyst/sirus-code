import type { AgentEvent, Message } from "@/client/types";

/** Rust owns message identity, role and initial content. Deltas are idempotent against newer snapshots. */
export function applyAgentOutput(messages: Message[], event: AgentEvent): Message[] {
  const index = messages.findIndex((message) => message.id === event.messageId);
  if (event.message) {
    if (index < 0) return [...messages, event.message];
    if (messages[index].content.length >= event.message.content.length) return messages;
    return messages.map((message, position) => position === index ? { ...event.message!, activity: message.activity ?? event.message!.activity, streaming: message.streaming } : message);
  }
  if (index < 0 || messages[index].content.length !== event.offset) return messages;
  return messages.map((message, position) => position === index ? { ...message, content: message.content + event.chunk } : message);
}

/**
 * A native snapshot replaces every message object. Keep the previous object when a
 * message did not change, so memoized transcript rows skip re-rendering. A false
 * mismatch (for example a different key order) only costs one render.
 */
export function reuseMessages(previous: Message[], next: Message[]): Message[] {
  if (!previous.length) return next;
  const byId = new Map(previous.map((message) => [message.id, message]));
  let changed = previous.length !== next.length;
  const merged = next.map((message, index) => {
    const old = byId.get(message.id);
    const keep = old !== undefined && sameMessage(old, message);
    if (!keep || previous[index] !== old) changed = true;
    return keep ? old : message;
  });
  return changed ? merged : previous;
}

function sameMessage(a: Message, b: Message) {
  return a.content === b.content && a.streaming === b.streaming
    && JSON.stringify({ ...a, content: "" }) === JSON.stringify({ ...b, content: "" });
}
