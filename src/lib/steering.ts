import type { AgentProviderId, Message } from "@/client/types";

/** Providers whose running reply accepts instructions (Codex `turn/steer`, Claude input during a turn). */
export function canSteer(agent: AgentProviderId | undefined, status: string | undefined): boolean {
  return (agent === "codex" || agent === "claude") && (status === "starting" || status === "running" || status === "waiting");
}

/** A running `/compact` takes no instructions: a message sent meanwhile waits in the queue. */
export function compactingTurn(messages: readonly Pick<Message, "role" | "content">[] | undefined): boolean {
  for (let index = (messages?.length ?? 0) - 1; index >= 0; index -= 1) {
    if (messages![index].role === "user") return messages![index].content.trim() === "/compact";
  }
  return false;
}
