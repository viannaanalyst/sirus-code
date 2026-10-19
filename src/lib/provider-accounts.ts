import type { AgentProviderId, ProviderAccount, ProviderUsage, Session } from "@/client/types";
import { tightestUsageWindow } from "@/lib/provider-usage";

export function supportsProviderAccounts(provider: AgentProviderId): boolean {
  return provider === "codex" || provider === "claude";
}
export function providerAccounts(provider: AgentProviderId, accounts: ProviderAccount[]): ProviderAccount[] {
  return [{ id: "default", provider, label: "Default account" }, ...accounts.filter((account) => account.provider === provider)];
}
export function activeProviderAccount(provider: AgentProviderId, session: Session | undefined | null, selections: Partial<Record<AgentProviderId, string>>): string {
  return session?.agent === provider ? session.providerAccountId ?? "default" : selections[provider] ?? "default";
}

/** One account a usage-limited conversation could continue on. */
export interface AccountChoice {
  account: ProviderAccount;
  /** Remaining quota of the most constrained window, 0–100 (rounded up: 0 only when spent), when the provider reports it. */
  remaining: number | null;
  plan: string | null;
  /** Signed in (its usage read named an identity) and not out of quota. */
  eligible: boolean;
}

/**
 * The provider's other accounts, for "Continue on another account": signed-in ones with quota
 * left first (most remaining first, unknown quota after), then the rest, which stay listed but
 * cannot be picked. An account whose usage has not been read yet is not eligible.
 */
export function accountChoices(provider: AgentProviderId, currentId: string, accounts: ProviderAccount[], usage: Record<string, ProviderUsage | undefined>): AccountChoice[] {
  return providerAccounts(provider, accounts).filter((account) => account.id !== currentId).map((account) => {
    const read = usage[account.id];
    const used = tightestUsageWindow(read)?.usedPercent;
    const remaining = used == null ? null : Math.max(0, Math.min(100, Math.ceil(100 - used)));
    return { account, remaining, plan: read?.account?.plan ?? null, eligible: Boolean(read?.account?.email) && (used == null || used < 100) };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || (b.remaining ?? -1) - (a.remaining ?? -1));
}
