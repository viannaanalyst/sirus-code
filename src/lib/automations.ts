import type { AutomationRun, AutomationSchedule, Session } from "@/client/types";

export const WEEKDAYS = ["automations.weekday.0", "automations.weekday.1", "automations.weekday.2", "automations.weekday.3", "automations.weekday.4", "automations.weekday.5", "automations.weekday.6"];
export const INTERVALS = [15, 30, 60, 120, 240, 360, 720, 1440];

type T = (key: string, values?: Record<string, string | number>) => string;

/** Human summary of a schedule ("Daily at 09:00", "Every 2 h"…). */
export function scheduleLabel(schedule: AutomationSchedule, t: T, locale: string): string {
  switch (schedule.kind) {
    case "manual": return t("automations.schedule.manual");
    case "once": return t("automations.summary.once", { at: new Date(schedule.at).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) });
    case "hourly": return t("automations.summary.hourly", { minute: String(schedule.minute).padStart(2, "0") });
    case "daily": return t("automations.summary.daily", { time: schedule.time });
    case "weekdays": return t("automations.summary.weekdays", { time: schedule.time });
    case "weekly": return t("automations.summary.weekly", { day: t(WEEKDAYS[schedule.weekday] ?? WEEKDAYS[0]), time: schedule.time });
    case "interval": return schedule.minutes % 60 === 0
      ? t("automations.summary.everyHours", { hours: schedule.minutes / 60 })
      : t("automations.summary.everyMinutes", { minutes: schedule.minutes });
  }
}

export type RunState = "running" | "waiting" | "completed" | "failed" | "stopped" | "skipped" | "missing";

/** A started run's state is its session's; the session may have been deleted. */
export function runState(run: AutomationRun, sessions: readonly Pick<Session, "id" | "status">[]): RunState {
  if (run.status === "skipped") return "skipped";
  if (run.status === "failed") return "failed";
  const session = sessions.find((item) => item.id === run.sessionId);
  if (!session) return "missing";
  if (session.status === "waiting") return "waiting";
  if (session.status === "running" || session.status === "starting") return "running";
  if (session.status === "failed") return "failed";
  if (session.status === "stopped") return "stopped";
  return "completed";
}
