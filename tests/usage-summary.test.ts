import assert from "node:assert/strict";
import { test } from "node:test";
import type { UsageHistoryEntry } from "../src/client/types.ts";
import { entryCost, formatShare, modelPrice, sortModelRows, summarizeUsage, usageBuckets } from "../src/lib/usage-summary.ts";

const HOUR = 60 * 60 * 1000;
const now = new Date(2026, 9, 18, 15, 30).getTime();
const entry = (hoursAgo: number, provider: UsageHistoryEntry["provider"], model: string, extra: Partial<UsageHistoryEntry> = {}): UsageHistoryEntry => ({
  at: Math.floor((now - hoursAgo * HOUR) / HOUR) * HOUR, provider, model, session: `${provider}-s1`,
  inputTokens: 1_000_000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reportedCostUsd: null, speed: "standard", ...extra,
});

test("prices: the longest prefix wins, unknown models have none, a logged cost wins over the estimate", () => {
  assert.equal(modelPrice("claude-opus-5-5")?.input, 4);
  assert.equal(modelPrice("claude-opus-5")?.input, 5);
  assert.equal(modelPrice("claude-sonnet-4-6")?.output, 15);
  assert.equal(modelPrice("gpt-6.1-sol"), null);
  assert.equal(entryCost(entry(1, "claude", "claude-opus-5-5", { cachedInputTokens: 1_000_000, outputTokens: 1_000_000 })), 4 + 0.2 + 20);
  assert.equal(entryCost(entry(1, "codex", "gpt-6.1-sol")), null);
  assert.equal(entryCost(entry(1, "opencode", "big-pickle", { reportedCostUsd: 0.5 })), 0.5);
  // The downloaded table wins over the built-in list and prices models the list lacks.
  const table = { "gpt-6.1-sol": { input: 2, cacheRead: 0.1, cacheWrite: 2, output: 10 }, "claude-opus-5-5": { input: 3, cacheRead: 0.3, cacheWrite: 3.75, output: 15 } };
  assert.equal(entryCost(entry(1, "codex", "gpt-6.1-sol", { cachedInputTokens: 1_000_000 }), table), 2.1);
  assert.equal(entryCost(entry(1, "claude", "claude-opus-5-5"), table), 3);
  assert.equal(summarizeUsage([entry(1, "codex", "gpt-6.1-sol")], 7, now, table).partialCost, false);
});

test("fast entries use the table's fast prices when it has them, else the standard ones", () => {
  const fast = { input: 4, cacheRead: 0.2, cacheWrite: 5, output: 20 };
  const table = { "gpt-6.1-sol": { input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10, fast }, "gpt-6.1-luna": { input: 1, cacheRead: 0.1, cacheWrite: 1, output: 4, fast: null } };
  const priority = entry(1, "codex", "gpt-6.1-sol", { speed: "fast", cachedInputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.equal(entryCost(priority, table), 4 + 0.2 + 20);
  assert.equal(entryCost({ ...priority, speed: "standard" }, table), 2 + 0.1 + 10);
  assert.equal(entryCost(entry(1, "codex", "gpt-6.1-luna", { speed: "fast" }), table), 1);
  // The built-in Anthropic list has no fast prices: fast entries fall back to standard.
  assert.equal(entryCost(entry(1, "claude", "claude-opus-5-5", { speed: "fast" })), 4);
  const summary = summarizeUsage([priority, entry(2, "codex", "gpt-6.1-sol")], 7, now, table);
  assert.ok(Math.abs(summary.costBySpeed.fast - 24.2) < 1e-9);
  assert.ok(Math.abs(summary.costBySpeed.standard - 2) < 1e-9);
  assert.ok(Math.abs(summary.costByType.output - 20) < 1e-9);
  assert.ok(Math.abs(summary.cacheSavings - (4 - 0.2)) < 1e-9);
});

test("buckets: 24 hourly ones for a day, local days otherwise, oldest first", () => {
  const hours = usageBuckets(1, now);
  assert.equal(hours.length, 24);
  assert.equal(hours[23], Math.floor(now / HOUR) * HOUR);
  const days = usageBuckets(7, now);
  assert.equal(days.length, 7);
  assert.equal(new Date(days[6]).getDate(), 18);
  assert.equal(new Date(days[0]).getDate(), 12);
  assert.equal(new Date(days[0]).getHours(), 0);
});

test("summary: totals, distinct sessions, unpriced models, buckets and the range cut", () => {
  const entries = [
    entry(2, "claude", "claude-opus-5-5", { outputTokens: 100_000 }),
    entry(30, "claude", "claude-opus-5-5", { session: "claude-s2", cachedInputTokens: 2_000_000 }),
    entry(5, "codex", "gpt-6.1-sol"),
    entry(24 * 40, "claude", "claude-opus-5-5"),
  ];
  const week = summarizeUsage(entries, 7, now);
  assert.equal(week.tokens, 1_000_000 + 100_000 + 1_000_000 + 2_000_000 + 1_000_000);
  assert.equal(week.sessions, 3);
  assert.ok(week.partialCost);
  assert.deepEqual(week.providers.map(total => [total.provider, total.sessions, total.unpriced]), [["claude", 2, false], ["codex", 1, true]]);
  assert.equal(Math.round(week.cost * 100) / 100, Math.round((4 + 2 + 4 + 0.4) * 100) / 100);
  assert.ok(Math.abs(week.cacheSavings - 2 * (4 - 0.2)) < 1e-9);
  assert.equal(week.buckets.reduce((sum, bucket) => sum + bucket.values.claude.tokens + bucket.values.codex.tokens, 0), week.tokens);
  assert.deepEqual(sortModelRows(week.models, "cost").map(row => row.model), ["claude-opus-5-5", "gpt-6.1-sol"]);
  const day = summarizeUsage(entries, 1, now);
  assert.equal(day.bucket, "hour");
  assert.equal(day.sessions, 2);
  assert.equal(summarizeUsage(entries, 90, now).tokens, week.tokens + 1_000_000);
});

test("shares read as percentages, with a floor label below a tenth", () => {
  assert.equal(formatShare(1, 4, "en"), "25%");
  assert.equal(formatShare(1, 10_000, "en"), "<0.1%");
  assert.equal(formatShare(0, 0, "en"), "—");
});
