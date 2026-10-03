import test from "node:test";
import assert from "node:assert/strict";
import type { ProviderUsage } from "../src/client/types.ts";
import { primaryUsageWindow, resetDuration, usageWindowLabel } from "../src/lib/provider-usage.ts";
import { mergeSettings, defaultSettings } from "../src/lib/settings.ts";
import { client } from "../src/client/index.ts";
import { useAppStore } from "../src/store/app-store.ts";

const fixture: ProviderUsage = { provider: "codex", status: "available", windows: [
  { id: "codex/primary", usedPercent: 8, durationMinutes: 300, resetsAt: 1_790_000_000_000 },
  { id: "codex/secondary", usedPercent: 17, durationMinutes: 10_080, resetsAt: 1_790_600_000_000 },
], updatedAt: 1_790_000_000_000, note: null, account: null, resetCount: 1, resetOffer: "native-offer" };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };

test("compact usage prefers the longer real window and never creates a percentage", () => {
  assert.equal(primaryUsageWindow(fixture)?.usedPercent, 17);
  assert.equal(primaryUsageWindow(undefined), undefined);
  assert.equal(primaryUsageWindow({ ...fixture, windows: [{ ...fixture.windows[0], usedPercent: null }] })?.usedPercent, null);
  assert.equal(resetDuration(1_000 + (6 * 24 + 21) * 3_600_000, 1_000), "6d 21h");
  assert.equal(resetDuration(null, 1_000), null); assert.equal(resetDuration(1, 1_000), "0m");
});

test("usage visibility preferences persist with bounded distinct provider IDs", () => {
  assert.deepEqual(mergeSettings({}).usageProviders, ["codex"]);
  assert.deepEqual(mergeSettings({ usageProviders: ["claude", "codex", "claude"] }).usageProviders, ["claude", "codex"]);
  assert.deepEqual(mergeSettings({ usageProviders: [] }).usageProviders, []);
});

test("calendar-month quota is selected without inventing a fixed monthly duration", () => {
  const monthly = { ...fixture.windows[0], id: "opencode-go/monthly", durationMinutes: null, usedPercent: 43 };
  const usage = { ...fixture, provider: "opencode" as const, windows: [fixture.windows[1], monthly] };
  assert.equal(primaryUsageWindow(usage), monthly);
  assert.equal(usageWindowLabel(monthly), "Monthly usage");
  assert.equal(usageWindowLabel({ ...monthly, id: "cursor/models" }), "Cursor models");
  assert.equal(usageWindowLabel({ ...monthly, id: "cursor/other-models" }), "Other models");
});

test("usage account identity follows the authoritative snapshot and disappears on rejected reads", async (context) => {
  const account = { email: "fixture@example.test", name: null, plan: "pro", keyFingerprint: null };
  context.mock.method(client, "providerUsage", async () => ({ ...fixture, account }));
  useAppStore.setState({ settings: defaultSettings, usageByProvider: {} });
  await useAppStore.getState().refreshProviderUsage("codex", true);
  assert.deepEqual(useAppStore.getState().usageByProvider.codex?.account, account);
  context.mock.method(client, "providerUsage", async () => { throw new Error("credential not exported"); });
  await useAppStore.getState().refreshProviderUsage("codex", true);
  assert.equal(useAppStore.getState().usageByProvider.codex?.account, null);
});

test("usage refresh coalesces concurrent reads and rejects responses from a changed executable", async (context) => {
  const read = deferred<ProviderUsage>(); let count = 0;
  context.mock.method(client, "providerUsage", () => { count++; return read.promise; });
  useAppStore.setState({ settings: defaultSettings, usageByProvider: {}, usageLoading: {} });
  const first = useAppStore.getState().refreshProviderUsage("codex");
  const second = useAppStore.getState().refreshProviderUsage("codex", true);
  assert.equal(count, 1);
  useAppStore.setState({ settings: { ...defaultSettings, providerPaths: { codex: "/new/cli" } } });
  read.resolve(fixture); await Promise.all([first, second]);
  assert.equal(useAppStore.getState().usageByProvider.codex, undefined); assert.equal(useAppStore.getState().usageLoading.codex, false);
});

test("reset is one operation at a time, keeps the native offer, and publishes the authoritative result", async (context) => {
  const result = deferred<import("../src/client/types.ts").CodexResetResult>(); const offers: string[] = [];
  context.mock.method(client, "consumeCodexReset", (offer: string) => { offers.push(offer); return result.promise; });
  useAppStore.setState({ settings: defaultSettings, usageByProvider: { codex: fixture } });
  const reset = useAppStore.getState().consumeCodexReset("native-offer");
  await assert.rejects(useAppStore.getState().consumeCodexReset("another-offer"), /already in progress/);
  const after = { ...fixture, resetCount: 0, resetOffer: null, windows: [{ ...fixture.windows[0], usedPercent: 0 }] };
  result.resolve({ outcome: "reset", usage: after }); await reset;
  assert.deepEqual(offers, ["native-offer"]); assert.equal(useAppStore.getState().usageByProvider.codex?.windows[0].usedPercent, 0);
});

test("changing the executable during a read queues the new provider probe rather than losing it", async (context) => {
  const old = deferred<ProviderUsage>(); let count = 0;
  context.mock.method(client, "providerUsage", () => ++count === 1 ? old.promise : Promise.resolve({ ...fixture, windows: [{ ...fixture.windows[0], usedPercent: 42 }] }));
  useAppStore.setState({ settings: defaultSettings, usageByProvider: {} });
  const first = useAppStore.getState().refreshProviderUsage("codex");
  useAppStore.setState({ settings: { ...defaultSettings, providerPaths: { codex: "/new/cli" } } });
  const second = useAppStore.getState().refreshProviderUsage("codex");
  old.resolve(fixture); await Promise.all([first, second]);
  assert.equal(count, 2); assert.equal(useAppStore.getState().usageByProvider.codex?.windows[0].usedPercent, 42);
});

test("usage errors do not reuse stale percentages or pretend a clean quota", async (context) => {
  context.mock.method(client, "providerUsage", async () => { throw new Error("vendor secret details"); });
  useAppStore.setState({ settings: defaultSettings, usageByProvider: { codex: fixture } });
  await useAppStore.getState().refreshProviderUsage("codex", true);
  const usage = useAppStore.getState().usageByProvider.codex;
  assert.equal(usage?.status, "error"); assert.deepEqual(usage?.windows, []); assert.equal(usage?.resetOffer, null); assert.ok(!usage?.note?.includes("secret"));
});

test("a failed reset retires its offer without guessing new usage or automatically redeeming again", async (context) => {
  let calls = 0;
  context.mock.method(client, "consumeCodexReset", async () => { calls++; throw new Error("uncertain result"); });
  useAppStore.setState({ settings: defaultSettings, usageByProvider: { codex: fixture } });
  await assert.rejects(useAppStore.getState().consumeCodexReset("native-offer"), /uncertain result/);
  assert.equal(calls, 1); assert.equal(useAppStore.getState().usageByProvider.codex?.resetOffer, null);
  assert.equal(useAppStore.getState().usageByProvider.codex?.windows[0].usedPercent, 8);
  assert.equal(useAppStore.getState().usageLoading.codex, false);
});
