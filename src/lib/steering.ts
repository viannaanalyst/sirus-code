import type { AgentProviderId } from "@/client/types";

/** Providers whose running reply accepts instructions (Codex `turn/steer`, Claude input during a turn). */
export function canSteer(agent: AgentProviderId | undefined, status: string | undefined): boolean {
  return (agent === "codex" || agent === "claude") && (status === "starting" || status === "running" || status === "waiting");
}
