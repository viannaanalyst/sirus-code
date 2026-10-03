import type { AgentProviderId, ProviderAccount, Session } from "@/client/types";

export function supportsProviderAccounts(provider: AgentProviderId): boolean {
  return provider === "codex" || provider === "claude";
}
export function providerAccounts(provider: AgentProviderId, accounts: ProviderAccount[]): ProviderAccount[] {
  return [{ id: "default", provider, label: "Default account" }, ...accounts.filter((account) => account.provider === provider)];
}
export function activeProviderAccount(provider: AgentProviderId, session: Session | undefined | null, selections: Partial<Record<AgentProviderId, string>>): string {
  return session?.agent === provider ? session.providerAccountId ?? "default" : selections[provider] ?? "default";
}
