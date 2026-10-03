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
