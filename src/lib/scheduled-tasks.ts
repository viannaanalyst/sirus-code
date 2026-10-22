import type { ScheduledTask, ScheduledTaskSchedule, ScheduledTaskWebhookFilter } from "@/client/types";

/**
 * Scheduled tasks on the Tasks page (ADR-142): labels for a schedule and its next run, the
 * editor's form and its preview of the next run. The native timer is the source of truth;
 * the preview only mirrors its rules so the person sees when a task would run before saving.
 */
export type ScheduleKind = ScheduledTaskSchedule["kind"];
export type IntervalUnit = "minutes" | "hours" | "days";

export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 7 * 24 * 60;
/** Webhook tasks (ADR-161): the native checks mirrored for the editor. */
export const MAX_WEBHOOK_FILTERS = 8;
export const DEFAULT_DEDUPE_MINUTES = 60;
export const MAX_DEDUPE_MINUTES = 7 * 24 * 60;

/** The editor's fields; turned into a schedule on save. */
export interface ScheduleForm {
  kind: ScheduleKind;
  /** "YYYY-MM-DD" for a one-off run. */
  date: string;
  /** "HH:MM" for once, daily and weekly. */
  time: string;
  /** 0 = Sunday … 6. */
  days: number[];
  every: number;
  unit: IntervalUnit;
  /** Webhook: rows of the filter editor (an empty value means "is present"). */
  filters: { path: string; equals: string }[];
  dedupeMinutes: number;
}

const UNIT_MINUTES: Record<IntervalUnit, number> = { minutes: 1, hours: 60, days: 1440 };

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function localDate(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localTime(time: number): string {
  const date = new Date(time);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A new task's form: daily at 09:00, with a one-off tomorrow at 09:00 ready if picked. */
export function defaultScheduleForm(now: number): ScheduleForm {
  return { kind: "daily", date: localDate(now + 24 * 60 * 60 * 1000), time: "09:00", days: [1, 2, 3, 4, 5], every: 4, unit: "hours", filters: [], dedupeMinutes: DEFAULT_DEDUPE_MINUTES };
}

export function scheduleToForm(schedule: ScheduledTaskSchedule, now: number): ScheduleForm {
  const form = defaultScheduleForm(now);
  switch (schedule.kind) {
    case "once": return { ...form, kind: "once", date: localDate(schedule.at), time: localTime(schedule.at) };
    case "daily": return { ...form, kind: "daily", time: schedule.time };
    case "weekly": return { ...form, kind: "weekly", time: schedule.time, days: [...schedule.days].sort() };
    case "interval": {
      const unit: IntervalUnit = schedule.minutes % 1440 === 0 ? "days" : schedule.minutes % 60 === 0 ? "hours" : "minutes";
      return { ...form, kind: "interval", every: schedule.minutes / UNIT_MINUTES[unit], unit };
    }
    case "webhook": return { ...form, kind: "webhook", filters: schedule.filters.map(filter => ({ path: filter.path, equals: filter.equals ?? "" })), dedupeMinutes: schedule.dedupeMinutes };
  }
}

/** A filter path reads `headers.<name>` or `body.<field>`, without spaces. */
export function validFilterPath(path: string): boolean {
  return /^(headers|body)\.\S+$/.test(path.trim()) && path.trim().length <= 200;
}

function validTime(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return !!match && Number(match[1]) < 24 && Number(match[2]) < 60;
}

/** The schedule the form describes, or the reason (a translation key) it cannot be saved. */
export function formToSchedule(form: ScheduleForm, now: number): { schedule: ScheduledTaskSchedule } | { error: string } {
  if (form.kind === "webhook") {
    const rows = form.filters.filter(row => row.path.trim() || row.equals.trim());
    if (rows.length > MAX_WEBHOOK_FILTERS || rows.some(row => !validFilterPath(row.path) || row.equals.length > 500)) return { error: "scheduled.error.filter" };
    const dedupeMinutes = Math.round(form.dedupeMinutes);
    if (!Number.isFinite(dedupeMinutes) || dedupeMinutes < 0 || dedupeMinutes > MAX_DEDUPE_MINUTES) return { error: "scheduled.error.dedupe" };
    const filters: ScheduledTaskWebhookFilter[] = rows.map(row => row.equals ? { path: row.path.trim(), equals: row.equals } : { path: row.path.trim() });
    return { schedule: { kind: "webhook", filters, dedupeMinutes } };
  }
  if (form.kind === "interval") {
    const minutes = Math.round(form.every * UNIT_MINUTES[form.unit]);
    if (!Number.isFinite(minutes) || minutes < MIN_INTERVAL_MINUTES || minutes > MAX_INTERVAL_MINUTES) return { error: "scheduled.error.interval" };
    return { schedule: { kind: "interval", minutes } };
  }
  if (!validTime(form.time)) return { error: "scheduled.error.time" };
  if (form.kind === "daily") return { schedule: { kind: "daily", time: form.time } };
  if (form.kind === "weekly") {
    const days = [...new Set(form.days)].filter(day => day >= 0 && day <= 6).sort();
    return days.length ? { schedule: { kind: "weekly", days, time: form.time } } : { error: "scheduled.error.days" };
  }
  const at = new Date(`${form.date}T${form.time}:00`).getTime();
  if (!Number.isFinite(at)) return { error: "scheduled.error.time" };
  return at > now ? { schedule: { kind: "once", at } } : { error: "scheduled.error.past" };
}

function atTime(day: Date, time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date(day);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

/** The next run after `now` as the native timer computes it (interval: from now). */
export function previewNextRun(schedule: ScheduledTaskSchedule, now: number): number | null {
  switch (schedule.kind) {
    case "once": return schedule.at > now ? schedule.at : null;
    case "webhook": return null;
    case "interval": return now + schedule.minutes * 60_000;
    case "daily":
    case "weekly": {
      const days = schedule.kind === "weekly" ? schedule.days : [0, 1, 2, 3, 4, 5, 6];
      const start = new Date(now);
      for (let offset = 0; offset <= 7; offset += 1) {
        const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
        if (!days.includes(day.getDay())) continue;
        const at = atTime(day, schedule.time);
        if (at > now) return at;
      }
      return null;
    }
  }
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Short weekday names in the person's locale, Sunday first. */
export function weekdayNames(locale: string, width: "short" | "narrow" = "short"): string[] {
  const sunday = new Date(2026, 0, 4);
  return Array.from({ length: 7 }, (_, day) => new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + day).toLocaleDateString(locale, { weekday: width }).replace(/\.$/, ""));
}

/** "Every day at 02:00", "Mon, Wed at 09:00", "Weekdays at 09:00", "Every 4 hours", "Sun 19 Oct at 00:00". */
export function scheduleLabel(schedule: ScheduledTaskSchedule, t: Translate, locale: string): string {
  switch (schedule.kind) {
    case "webhook": return t("scheduled.label.webhook");
    case "daily": return t("scheduled.label.daily", { time: schedule.time });
    case "weekly": {
      const days = [...schedule.days].sort();
      if (days.join() === "1,2,3,4,5") return t("scheduled.label.weekdays", { time: schedule.time });
      if (days.length === 7) return t("scheduled.label.daily", { time: schedule.time });
      const names = weekdayNames(locale);
      return t("scheduled.label.weekly", { days: days.map(day => names[day]).join(", "), time: schedule.time });
    }
    case "interval": {
      const { minutes } = schedule;
      if (minutes % 1440 === 0) return t(minutes === 1440 ? "scheduled.label.everyDay" : "scheduled.label.everyDays", { count: minutes / 1440 });
      if (minutes % 60 === 0) return t(minutes === 60 ? "scheduled.label.everyHour" : "scheduled.label.everyHours", { count: minutes / 60 });
      return t("scheduled.label.everyMinutes", { count: minutes });
    }
    case "once": {
      const date = new Date(schedule.at);
      return t("scheduled.label.once", { day: date.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" }), time: localTime(schedule.at) });
    }
  }
}

/** "in 4h", "in 2d", "in 12m", "in under a minute". */
export function relativeIn(at: number, now: number, t: Translate): string {
  const minutes = Math.round((at - now) / 60_000);
  if (minutes < 1) return t("scheduled.in.soon");
  if (minutes < 60) return t("scheduled.in.minutes", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t("scheduled.in.hours", { count: hours });
  return t("scheduled.in.days", { count: Math.round(hours / 24) });
}

/** Tasks in the order the list shows: enabled by next run, then paused, newest first. */
export function sortScheduledTasks(tasks: readonly ScheduledTask[]): ScheduledTask[] {
  return [...tasks].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    if (a.enabled) return (a.nextRunAt ?? Number.POSITIVE_INFINITY) - (b.nextRunAt ?? Number.POSITIVE_INFINITY);
    return b.updatedAt - a.updatedAt;
  });
}

/** Tasks whose runs continue this conversation, soonest first (the line above its composer). */
export function tasksBoundTo(tasks: readonly ScheduledTask[], sessionId: string): ScheduledTask[] {
  return sortScheduledTasks(tasks.filter(task => task.sessionId === sessionId && task.enabled));
}
