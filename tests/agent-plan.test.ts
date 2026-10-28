import { test } from "node:test";
import assert from "node:assert/strict";
import { latestPlan, planProgress, planSignature, planVisible } from "../src/lib/agent-plan.ts";
import { planEnglish, planPortuguese } from "../src/i18n/plan-strings.ts";
import type { Message, PlanEntry } from "../src/client/types.ts";

const step = (text: string, status: PlanEntry["status"]): PlanEntry => ({ text, status });
const reply = (id: string, plan?: PlanEntry[], role: Message["role"] = "agent") => ({ id, sessionId: "s", role, content: "", createdAt: "", streaming: false, activity: plan ? { plan } : undefined }) as unknown as Message;

test("the tray reads the newest plan of the conversation, whole", () => {
  const old = [step("Old", "completed")];
  const fresh = [step("A", "completed"), step("B", "inProgress"), step("C", "pending")];
  assert.deepEqual(latestPlan([reply("1", old), reply("2", fresh), reply("3")]), fresh);
  assert.deepEqual(latestPlan([reply("1", undefined, "user")]), []);
  assert.deepEqual(latestPlan([]), []);
});

test("the summary names the step in progress, else the first unfinished one", () => {
  const plan = [step("A", "completed"), step("B", "inProgress"), step("C", "pending")];
  assert.deepEqual({ ...planProgress(plan), current: planProgress(plan).current?.text }, { done: 1, total: 3, complete: false, current: "B" });
  assert.equal(planProgress([step("A", "completed"), step("C", "pending")]).current?.text, "C");
  const done = planProgress([step("A", "completed")]);
  assert.equal(done.complete, true);
  assert.equal(done.current, null);
  assert.equal(planProgress([]).complete, false);
});

test("show and hide rules", () => {
  const open = [step("A", "completed"), step("B", "pending")];
  const complete = [step("A", "completed"), step("B", "completed")];
  assert.equal(planVisible([], "running", undefined), false);
  assert.equal(planVisible(open, "running", undefined), true);
  // Unfinished work stays visible after the turn ends (stopped, failed or finished early).
  assert.equal(planVisible(open, "completed", undefined), true);
  // Complete: shown while the turn still runs, gone once it ended.
  assert.equal(planVisible(complete, "running", undefined), true);
  assert.equal(planVisible(complete, "waiting", undefined), true);
  assert.equal(planVisible(complete, "completed", undefined), false);
  assert.equal(planVisible(complete, undefined, undefined), false);
  // Dismissed until the plan changes.
  assert.equal(planVisible(open, "running", planSignature(open)), false);
  const next = [step("A", "completed"), step("B", "inProgress")];
  assert.equal(planVisible(next, "running", planSignature(open)), true);
});

test("plan strings exist in both languages", () => {
  assert.deepEqual(Object.keys(planEnglish).sort(), Object.keys(planPortuguese).sort());
});
