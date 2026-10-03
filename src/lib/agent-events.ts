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
