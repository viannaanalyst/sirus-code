import type { ActivityItem, TurnActivity } from "@/client/types";
import { formatActivityDuration } from "@/lib/agent-activity";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Claude subagents launched with `run_in_background` (ADR-097). The turn keeps its process
 * while they run; one still running when the turn ended was interrupted (`stopped`).
 */
export function backgroundItems(activity: TurnActivity | null | undefined): ActivityItem[] {
  return activity?.items.filter((item) => item.kind === "agent" && item.background) ?? [];
}

export function runningBackground(activity: TurnActivity | null | undefined): ActivityItem[] {
  return backgroundItems(activity).filter((item) => item.state === "running");
}

export function interruptedBackground(activity: TurnActivity | null | undefined): ActivityItem[] {
  return backgroundItems(activity).filter((item) => item.state === "stopped");
}

/** The CLI's task id behind a child row (`agent:<task id>`). */
export function backgroundTaskId(item: Pick<ActivityItem, "id">): string {
  return item.id.replace(/^agent:/, "");
}

export type BackgroundTone = "running" | "completed" | "failed" | "interrupted" | "timedOut";

export function backgroundTone(item: Pick<ActivityItem, "state" | "timedOut">): BackgroundTone {
  if (item.state === "running") return "running";
  if (item.state === "completed") return "completed";
  if (item.state === "failed") return "failed";
  return item.timedOut ? "timedOut" : "interrupted";
}

/** "Em execução há 2m", "Concluída em 3m 10s", "Falhou", "Interrompida". */
export function backgroundStateLabel(item: Pick<ActivityItem, "state" | "timedOut" | "startedAt" | "endedAt">, now: number, t: Translate): string {
  const tone = backgroundTone(item);
  const seconds = item.startedAt ? Math.max(0, Math.floor(((tone === "running" ? now : item.endedAt ?? now) - item.startedAt) / 1000)) : 0;
  if (tone === "running") return t("background.state.running", { duration: formatActivityDuration(seconds) });
  if (tone === "completed") return item.startedAt ? t("background.state.completed", { duration: formatActivityDuration(seconds) }) : t("status.completed");
  return t(`background.state.${tone}`);
}

/** The follow-up that asks the agent to run its interrupted background tasks again. */
export function resumeBackgroundPrompt(items: readonly Pick<ActivityItem, "label">[], t: Translate): string {
  const names = items.map((item) => item.label.trim() || t("background.unnamed")).join("; ");
  return t("background.resumePrompt", { names });
}
