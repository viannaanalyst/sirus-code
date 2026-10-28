import type { Message, PlanEntry, SessionStatus } from "@/client/types";
import { isActivityActive } from "@/lib/agent-activity";

/** The newest plan the agent wrote in this conversation: every update carries the whole list, so no history is needed (ADR-182). */
export function latestPlan(messages: readonly Message[]): PlanEntry[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "agent" && message.activity?.plan?.length) return message.activity.plan;
  }
  return [];
}

/** Identifies one version of a plan, so a dismissal holds until the agent writes a different list. */
export function planSignature(plan: readonly PlanEntry[]): string {
  return plan.map(entry => `${entry.status[0]}${entry.text}`).join("\n");
}

export interface PlanProgress { done: number; total: number; complete: boolean; current: PlanEntry | null }

/** Counts, and the step to name in the one-line summary: the one in progress, else the first unfinished. */
export function planProgress(plan: readonly PlanEntry[]): PlanProgress {
  const done = plan.filter(entry => entry.status === "completed").length;
  const current = plan.find(entry => entry.status === "inProgress") ?? plan.find(entry => entry.status !== "completed") ?? null;
  return { done, total: plan.length, complete: plan.length > 0 && done === plan.length, current };
}

/** Shown while work remains or the turn runs; gone once complete and the turn ended, or when dismissed (until the plan changes). */
export function planVisible(plan: readonly PlanEntry[], status: SessionStatus | undefined, dismissed: string | undefined): boolean {
  if (!plan.length) return false;
  if (dismissed !== undefined && dismissed === planSignature(plan)) return false;
  return !(planProgress(plan).complete && !(status && isActivityActive(status)));
}
