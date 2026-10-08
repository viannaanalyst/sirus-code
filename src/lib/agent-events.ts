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

type Same = (a: unknown, b: unknown) => boolean;

/**
 * Field-by-field equality without serializing: `handlers` compare nested fields
 * cheaply, other primitives compare by value. An unexpected nested field falls back
 * to JSON, so unknown shapes still count as changed when they differ.
 */
function sameFields(a: unknown, b: unknown, handlers: Record<string, Same> = {}): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  let count = 0;
  for (const key in left) {
    if (left[key] === undefined) continue;
    count += 1;
    const x = left[key], y = right[key];
    const handler = handlers[key];
    if (handler ? !handler(x, y) : x !== y && (typeof x !== "object" || typeof y !== "object" || x === null || y === null || JSON.stringify(x) !== JSON.stringify(y))) return false;
  }
  for (const key in right) if (right[key] !== undefined) count -= 1;
  return count === 0;
}

function sameList(same: Same): Same {
  return (a, b) => {
    if (a === b) return true;
    const left = (a ?? []) as unknown[], right = (b ?? []) as unknown[];
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) if (!same(left[index], right[index])) return false;
    return true;
  };
}

const flat: Same = (a, b) => sameFields(a, b);
const nullish = (same: Same): Same => (a, b) => (a ?? null) === (b ?? null) || same(a, b);
/** A thumbnail never changes for the same attachment id: its length stands in for the base64. */
const sameAttachment: Same = (a, b) => sameFields(a, b, { thumbnail: (x, y) => (x as string | undefined)?.length === (y as string | undefined)?.length });
const sameItem: Same = (a, b) => sameFields(a, b, { steps: sameList(flat) });
const sameReview: Same = nullish((a, b) => sameFields(a, b, { files: sameList(flat) }));
const sameActivity: Same = nullish((a, b) => sameFields(a, b, { items: sameList(sameItem), review: sameReview }));
const messageFields: Record<string, Same> = {
  activity: sameActivity,
  attachments: sameList(sameAttachment),
  steers: sameList(flat),
  launched: sameList(Object.is),
  documents: sameList(Object.is),
};

function sameMessage(a: Message, b: Message) {
  return a.content === b.content && a.streaming === b.streaming && sameFields(a, b, messageFields);
}
