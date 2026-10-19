import test from "node:test";
import assert from "node:assert/strict";
import { client } from "../src/client/index.ts";
import { useAppStore } from "../src/store/app-store.ts";
import { activeProviderAccount, providerAccounts, supportsProviderAccounts } from "../src/lib/provider-accounts.ts";
import type { Session, ProviderUsage } from "../src/client/types.ts";

const session = { id: "existing", agent: "codex", providerAccountId: "personal", messages: [] } as unknown as Session;
const quota = (id: string): ProviderUsage => ({ provider: "codex", providerAccountId: id, status: "available", windows: [], updatedAt: 1, account: { email: `${id}@example.test`, name: null, plan: null, keyFingerprint: null }, note: null, resetCount: 0, resetOffer: null });
test("account choices are provider scoped and saved sessions override new-session defaults", () => {
  const rows = [{ id: "work", provider: "codex" as const, label: "Work" }, { id: "other", provider: "claude" as const, label: "Claude" }];
  assert.deepEqual(providerAccounts("codex", rows).map((row) => row.id), ["default", "work"]);
  assert.equal(supportsProviderAccounts("cursor"), false);
  assert.equal(activeProviderAccount("codex", session, { codex: "work" }), "personal");
  assert.equal(activeProviderAccount("codex", null, { codex: "work" }), "work");
  assert.equal(activeProviderAccount("codex", { ...session, providerAccountId: undefined }, { codex: "work" }), "default");
});
test("selecting another account persists new-session selection without mutating an existing session", async () => {
  const original = client.selectProviderAccount; const originalUsage = client.providerUsage;
  const calls: string[] = [];
  client.selectProviderAccount = async (_provider, id) => { calls.push(id); };
  client.providerUsage = async (_provider, _force, id) => quota(id!);
  useAppStore.setState({ sessions: [session], selectedSessionId: session.id, selectedProviderAccounts: {}, usageByProvider: {} });
  try {
    await useAppStore.getState().selectProviderAccount("codex", "work");
    assert.deepEqual(calls, ["work"]);
    assert.equal(useAppStore.getState().selectedProviderAccounts.codex, "work");
    assert.equal(useAppStore.getState().sessions[0].providerAccountId, "personal");
    assert.equal(useAppStore.getState().usageByProvider.codex?.account?.email, "personal@example.test");
  } finally { client.selectProviderAccount = original; client.providerUsage = originalUsage; }
});
test("a changed account discards an old quota response and queues the newly selected profile", async () => {
  const original = client.providerUsage; let resolve!: (value: ProviderUsage) => void; const ids: string[] = [];
  client.providerUsage = async (_provider, _force, id) => { ids.push(id!); return id === "personal" ? new Promise((done) => { resolve = done; }) : quota(id!); };
  useAppStore.setState({ sessions: [], selectedSessionId: null, selectedProviderAccounts: { codex: "personal" }, usageByProvider: {} });
  try {
    const first = useAppStore.getState().refreshProviderUsage("codex", true);
    useAppStore.setState({ selectedProviderAccounts: { codex: "work" } });
    const second = useAppStore.getState().refreshProviderUsage("codex", true);
    resolve(quota("personal")); await Promise.all([first, second]);
    assert.deepEqual(ids, ["personal", "work"]);
    assert.equal(useAppStore.getState().usageByProvider.codex?.account?.email, "work@example.test");
  } finally { client.providerUsage = original; }
});
test("another account is offered at a usage limit only when it is signed in with quota left", async () => {
  const { accountChoices } = await import("../src/lib/provider-accounts.ts");
  const read = (id: string, used: number | null, email = true): ProviderUsage => ({ ...quota(id), account: email ? { email: `${id}@example.test`, name: null, plan: "Pro", keyFingerprint: null } : null, windows: used == null ? [] : [{ id: "five_hour", usedPercent: used, resetsAt: null, durationMinutes: 300 }, { id: "seven_day", usedPercent: 10, resetsAt: null, durationMinutes: 10080 }] });
  const rows = [
    { id: "spent", provider: "codex" as const, label: "Spent" },
    { id: "work", provider: "codex" as const, label: "Work" },
    { id: "unknown", provider: "codex" as const, label: "Unknown quota" },
    { id: "signedOut", provider: "codex" as const, label: "Signed out" },
    { id: "unread", provider: "codex" as const, label: "Not read yet" },
    { id: "claude", provider: "claude" as const, label: "Claude" },
  ];
  const usage = { default: read("default", 40), spent: read("spent", 100), work: read("work", 99.6), unknown: read("unknown", null), signedOut: read("signedOut", 0, false) };
  const choices = accountChoices("codex", "personal", rows, usage);
  assert.deepEqual(choices.map((choice) => [choice.account.id, choice.eligible, choice.remaining]), [
    ["default", true, 60], ["work", true, 1], ["unknown", true, null],
    ["signedOut", false, 90], ["spent", false, 0], ["unread", false, null],
  ]);
  assert.equal(choices[0].plan, "Pro");
  // The account in use is never offered; another provider's accounts never appear.
  assert.ok(!accountChoices("codex", "default", rows, usage).some((choice) => choice.account.id === "default" || choice.account.id === "claude"));
});
