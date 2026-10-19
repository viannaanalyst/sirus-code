import assert from "node:assert/strict";
import { test } from "node:test";
import { formToSchedule, defaultScheduleForm, previewNextRun, relativeIn, scheduleLabel, scheduleToForm, sortScheduledTasks, tasksBoundTo } from "../src/lib/scheduled-tasks.ts";

const t = (key: string, values: Record<string, string | number> = {}) => `${key}${Object.keys(values).length ? ":" + Object.values(values).join("|") : ""}`;
// Sunday 18 Oct 2026, 15:30 local.
const now = new Date(2026, 9, 18, 15, 30).getTime();

test("the form becomes a schedule, with the reasons it cannot be saved", () => {
  const form = defaultScheduleForm(now);
  assert.deepEqual(formToSchedule(form, now), { schedule: { kind: "daily", time: "09:00" } });
  assert.deepEqual(formToSchedule({ ...form, kind: "weekly", days: [5, 1, 1] }, now), { schedule: { kind: "weekly", days: [1, 5], time: "09:00" } });
  assert.deepEqual(formToSchedule({ ...form, kind: "weekly", days: [] }, now), { error: "scheduled.error.days" });
  assert.deepEqual(formToSchedule({ ...form, kind: "interval", every: 4, unit: "hours" }, now), { schedule: { kind: "interval", minutes: 240 } });
  assert.deepEqual(formToSchedule({ ...form, kind: "interval", every: 10, unit: "minutes" }, now), { error: "scheduled.error.interval" });
  assert.deepEqual(formToSchedule({ ...form, time: "25:00" }, now), { error: "scheduled.error.time" });
  assert.deepEqual(formToSchedule({ ...form, kind: "once", date: "2026-10-18", time: "10:00" }, now), { error: "scheduled.error.past" });
  const once = formToSchedule({ ...form, kind: "once", date: "2026-10-19", time: "00:00" }, now);
  assert.ok("schedule" in once && once.schedule.kind === "once" && once.schedule.at === new Date(2026, 9, 19, 0, 0).getTime());
  assert.deepEqual(scheduleToForm({ kind: "interval", minutes: 2880 }, now).unit, "days");
  assert.equal(scheduleToForm({ kind: "once", at: new Date(2026, 9, 19, 0, 0).getTime() }, now).date, "2026-10-19");
});

test("the next run: later today, tomorrow, the next chosen weekday, from now for intervals", () => {
  assert.equal(previewNextRun({ kind: "daily", time: "16:00" }, now), new Date(2026, 9, 18, 16, 0).getTime());
  assert.equal(previewNextRun({ kind: "daily", time: "02:00" }, now), new Date(2026, 9, 19, 2, 0).getTime());
  // Sunday now; Monday and Friday chosen → Monday.
  assert.equal(previewNextRun({ kind: "weekly", days: [1, 5], time: "09:00" }, now), new Date(2026, 9, 19, 9, 0).getTime());
  // Only Sunday at 09:00, already past today → next Sunday.
  assert.equal(previewNextRun({ kind: "weekly", days: [0], time: "09:00" }, now), new Date(2026, 9, 25, 9, 0).getTime());
  assert.equal(previewNextRun({ kind: "interval", minutes: 60 }, now), now + 3_600_000);
  assert.equal(previewNextRun({ kind: "once", at: now - 1 }, now), null);
});

test("labels and order", () => {
  assert.equal(scheduleLabel({ kind: "daily", time: "02:00" }, t, "en"), "scheduled.label.daily:02:00");
  assert.equal(scheduleLabel({ kind: "weekly", days: [1, 2, 3, 4, 5], time: "09:00" }, t, "en"), "scheduled.label.weekdays:09:00");
  assert.equal(scheduleLabel({ kind: "weekly", days: [1, 3], time: "09:00" }, t, "en"), "scheduled.label.weekly:Mon, Wed|09:00");
  assert.equal(scheduleLabel({ kind: "interval", minutes: 240 }, t, "en"), "scheduled.label.everyHours:4");
  assert.equal(scheduleLabel({ kind: "interval", minutes: 30 }, t, "en"), "scheduled.label.everyMinutes:30");
  assert.equal(relativeIn(now + 4 * 3_600_000, now, t), "scheduled.in.hours:4");
  assert.equal(relativeIn(now + 3 * 86_400_000, now, t), "scheduled.in.days:3");
  const task = (id: string, enabled: boolean, nextRunAt: number | null, sessionId: string | null = null) => ({ id, enabled, nextRunAt, updatedAt: 0, sessionId }) as never;
  assert.deepEqual(sortScheduledTasks([task("off", false, null), task("late", true, 9), task("soon", true, 1)]).map((item: { id: string }) => item.id), ["soon", "late", "off"]);
  assert.deepEqual(tasksBoundTo([task("a", true, 5, "s"), task("b", false, 1, "s"), task("c", true, 1, "x")], "s").map((item: { id: string }) => item.id), ["a"]);
});
