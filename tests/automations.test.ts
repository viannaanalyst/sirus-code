import { test } from "node:test";
import assert from "node:assert/strict";
import { relativeFromNow, runState, scheduleLabel, sortedAutomations } from "../src/lib/automations.ts";
import { translate } from "../src/i18n/index.ts";
import type { Automation, AutomationRun } from "../src/client/types.ts";

const t = (key: string, values?: Record<string, string | number>) => translate("pt-BR", key, values);

test("schedules read naturally in Portuguese", () => {
  assert.equal(scheduleLabel({ kind: "daily", time: "09:00" }, t, "pt-BR"), "Todo dia às 09:00");
  assert.equal(scheduleLabel({ kind: "weekly", weekday: 4, time: "18:30" }, t, "pt-BR"), "Toda sexta às 18:30");
  assert.equal(scheduleLabel({ kind: "interval", minutes: 120 }, t, "pt-BR"), "A cada 2 h");
  assert.equal(scheduleLabel({ kind: "interval", minutes: 45 }, t, "pt-BR"), "A cada 45 min");
  assert.equal(scheduleLabel({ kind: "hourly", minute: 5 }, t, "pt-BR"), "De hora em hora, aos :05");
});

test("a started run reports its session's state; skipped and failed runs keep theirs", () => {
  const run = (extra: Partial<AutomationRun>): AutomationRun => ({ id: "r", automationId: "a", sessionId: "s", startedAt: "t", manual: false, status: "started", note: null, ...extra });
  assert.equal(runState(run({}), [{ id: "s", status: "waiting" }]), "waiting");
  assert.equal(runState(run({}), [{ id: "s", status: "completed" }]), "completed");
  assert.equal(runState(run({}), []), "missing");
  assert.equal(runState(run({ status: "skipped", sessionId: null }), []), "skipped");
  assert.equal(runState(run({ status: "failed", sessionId: null }), []), "failed");
});

test("relative times and grouping", () => {
  const now = Date.parse("2026-10-05T10:00:00Z");
  assert.deepEqual(relativeFromNow("2026-10-05T12:00:00Z", now), { future: true, text: "2 h" });
  assert.deepEqual(relativeFromNow("2026-10-05T09:30:00Z", now), { future: false, text: "30 min" });
  assert.equal(relativeFromNow(null, now), null);
  const item = (name: string, enabled: boolean) => ({ name, enabled }) as Automation;
  const groups = sortedAutomations([item("b", true), item("a", true), item("c", false)]);
  assert.deepEqual(groups.active.map((a) => a.name), ["a", "b"]);
  assert.deepEqual(groups.paused.map((a) => a.name), ["c"]);
});
