import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSettings } from "../src/lib/settings.ts";
import { tightestUsageWindow } from "../src/lib/provider-usage.ts";
import type { AgentProviderId, ProviderUsage } from "../src/client/types.ts";

test("sidebar usage follows at most two providers that report usage", () => {
  assert.deepEqual(mergeSettings({}).sidebarUsageProviders, []);
  const chosen = ["grok", "claude", "claude", "codex", "cursor"] as AgentProviderId[];
  assert.deepEqual(mergeSettings({ sidebarUsageProviders: chosen }).sidebarUsageProviders, ["claude", "codex"]);
});

test("the ring shows the most constrained window", () => {
  const usage = { windows: [
    { id: "five_hour", usedPercent: 20, durationMinutes: 300, resetsAt: null },
    { id: "seven_day", usedPercent: 64, durationMinutes: 10080, resetsAt: null },
    { id: "unknown", usedPercent: null, durationMinutes: null, resetsAt: null },
  ] } as unknown as ProviderUsage;
  assert.equal(tightestUsageWindow(usage)?.id, "seven_day");
  assert.equal(tightestUsageWindow(undefined), undefined);
});
