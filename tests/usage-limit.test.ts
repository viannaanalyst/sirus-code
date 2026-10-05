import { test } from "node:test";
import assert from "node:assert/strict";
import { exhaustedReset, resetDistance, resumeAt, RESUME_GRACE_MS } from "../src/lib/usage-limit.ts";
import type { ProviderUsage } from "../src/client/types.ts";

const usage = (windows: ProviderUsage["windows"]): ProviderUsage => ({ provider: "codex", status: "available", windows, updatedAt: 0, note: null, account: null, resetCount: 0, resetOffer: null });

test("the reset comes from the latest spent window only", () => {
  const windows = [{ id: "primary", usedPercent: 100, resetsAt: 2_000, durationMinutes: 300 }, { id: "secondary", usedPercent: 100, resetsAt: 5_000, durationMinutes: 10_080 }, { id: "other", usedPercent: 60, resetsAt: 9_000, durationMinutes: 60 }] as ProviderUsage["windows"];
  assert.equal(exhaustedReset(usage(windows)), 5_000);
  assert.equal(exhaustedReset(usage([{ id: "primary", usedPercent: 99, resetsAt: 1, durationMinutes: 1 }] as ProviderUsage["windows"])), null);
  assert.equal(exhaustedReset(null), null);
});

test("resumes wait a grace period and distances round up to minutes", () => {
  assert.equal(resumeAt(1_000), 1_000 + RESUME_GRACE_MS);
  assert.equal(resumeAt(null), null);
  assert.deepEqual(resetDistance((4 * 60 + 42) * 60_000 - 5), { days: 0, hours: 4, minutes: 42 });
  assert.deepEqual(resetDistance(26 * 3_600_000), { days: 1, hours: 2, minutes: 0 });
  assert.deepEqual(resetDistance(-5), { days: 0, hours: 0, minutes: 1 });
});
