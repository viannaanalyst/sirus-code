import type { Session } from "@/client/types";

/** Snooze a conversation with a reminder (ADR-103): presets, countdowns and labels. Pure; the clock is passed in. */
export type SnoozePreset = "hour" | "threeHours" | "tomorrow" | "monday";
export const SNOOZE_PRESETS: readonly SnoozePreset[] = ["hour", "threeHours", "tomorrow", "monday"];
/** Presets that land on a morning use this local hour. */
export const SNOOZE_MORNING_HOUR = 9;

type T = (key: string, values?: Record<string, string | number>) => string;
const ACTIVE = ["starting", "running", "waiting"];

/** Running or waiting conversations cannot be snoozed (natively refused too). */
export function canSnooze(session: Pick<Session, "status">): boolean {
  return !ACTIVE.includes(session.status);
}

/** Snoozed and not taken back by a turn: such sessions leave tabs and lists for the "Snoozed" group. */
export function isSnoozed(session: Pick<Session, "status" | "snoozedUntil">): boolean {
  return Boolean(session.snoozedUntil) && canSnooze(session);
}

/** When a preset brings the conversation back, in the person's local time. */
export function snoozePresetTime(preset: SnoozePreset, now: Date): Date {
  // Hours are elapsed time (a DST change does not stretch them), on a whole minute.
  const later = (hours: number) => { const at = new Date(now.getTime() + hours * 3_600_000); at.setSeconds(0, 0); return at; };
  switch (preset) {
    case "hour": return later(1);
    case "threeHours": return later(3);
    case "tomorrow": return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, SNOOZE_MORNING_HOUR, 0, 0, 0);
    case "monday": {
      // The next Monday after today; on a Monday, the following one.
      const days = (8 - now.getDay()) % 7 || 7;
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, SNOOZE_MORNING_HOUR, 0, 0, 0);
    }
  }
}

const pad = (value: number) => String(value).padStart(2, "0");
/** `YYYY-MM-DD` and `HH:MM` for date and time inputs, in local time. */
export function dateInputValue(date: Date): string { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
export function timeInputValue(date: Date): string { return `${pad(date.getHours())}:${pad(date.getMinutes())}`; }

/** A local date and time from the picker's inputs; null when incomplete, invalid or not ahead of `now`. */
export function customSnoozeTime(date: string, time: string, now: Date): Date | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date), clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!day || !clock) return null;
  const [year, month, dayOfMonth, hours, minutes] = [day[1], day[2], day[3], clock[1], clock[2]].map(Number);
  const at = new Date(year, month - 1, dayOfMonth, hours, minutes, 0, 0);
  // Reject rollovers (31 Feb) and times not ahead; the native side also caps a year ahead.
  if (at.getFullYear() !== year || at.getMonth() !== month - 1 || at.getDate() !== dayOfMonth || at.getHours() !== hours) return null;
  return at.getTime() > now.getTime() ? at : null;
}

/** "9h" / "15:42" in Portuguese, "9 AM" / "3:42 PM" in English. */
export function snoozeClock(date: Date, locale: string): string {
  if (date.getMinutes() === 0) return locale === "pt-BR" ? `${date.getHours()}h` : date.toLocaleTimeString(locale, { hour: "numeric" });
  return date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

/** "today at 3:42 PM", "tomorrow at 9 AM", "Mon, Oct 13 at 9 AM", in the app's locale. */
export function snoozeDeadline(until: Date, now: Date, locale: string, t: T): string {
  const days = Math.round((new Date(until.getFullYear(), until.getMonth(), until.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  const time = snoozeClock(until, locale);
  if (days === 0) return t("snooze.todayAt", { time });
  if (days === 1) return t("snooze.tomorrowAt", { time });
  const options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", ...(until.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) };
  return t("snooze.dateAt", { date: until.toLocaleDateString(locale, options), time });
}

/** "2 h 10 min", "45 min", "3 d 4 h"; under a minute, null (the caller says "any moment"). */
export function snoozeRemaining(until: Date, now: Date): string | null {
  const minutes = Math.ceil((until.getTime() - now.getTime()) / 60_000);
  if (minutes < 1) return null;
  const days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), rest = minutes % 60;
  if (days) return hours ? `${days} d ${hours} h` : `${days} d`;
  if (hours) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  return `${rest} min`;
}

/** "back in 2 h 10 min" / "volta em 2 h 10 min". */
export function snoozeCountdown(until: string, now: Date, t: T): string {
  const remaining = snoozeRemaining(new Date(until), now);
  return remaining ? t("snooze.backIn", { time: remaining }) : t("snooze.backSoon");
}
