import { Plus, RefreshCw, Settings2, UserRound } from "@/components/icons/phosphor";
import { useState } from "react";
import type { AgentProviderId, ProviderUsage } from "@/client/types";
import { ProviderAccountsPanel } from "@/components/ProviderAccountsPanel";
import { activeProviderAccount, supportsProviderAccounts } from "@/lib/provider-accounts";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { resetDuration, resetOutcomeMessage, usageWindowLabel } from "@/lib/provider-usage";
import { useAppStore, selectCurrentSessionMeta } from "@/store/app-store";

const control = "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[6px] px-1.5 text-text-muted hover:bg-background-3 hover:text-text-secondary focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";

/**
 * One provider's quota: every window, the account it belongs to, named
 * accounts and the explicit Codex earned reset (ADR-013, ADR-015).
 */
export function ProviderUsagePanel({ provider, name, usage, loading, barColor }: { provider: AgentProviderId; name: string; usage: ProviderUsage | undefined; loading: boolean; barColor?: (used: number) => string }) {
  const t = useTranslation();
  const [confirmOffer, setConfirmOffer] = useState<string | null>(null);
  const [result, setResult] = useState<{ error: boolean; text: string } | null>(null);
  const [resetting, setResetting] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const refresh = useAppStore((state) => state.refreshProviderUsage);
  const session = useAppStore(selectCurrentSessionMeta);
  const selections = useAppStore((state) => state.selectedProviderAccounts);
  const currentId = activeProviderAccount(provider, session, selections);
  const now = Date.now();
  const confirming = !!usage?.resetOffer && confirmOffer === usage.resetOffer;
  const reset = async () => {
    const offer = usage?.resetOffer;
    if (!offer || !confirming || resetting) return;
    setResetting(true); setResult(null);
    try {
      const response = await useAppStore.getState().consumeCodexReset(offer);
      setResult({ error: false, text: resetOutcomeMessage[response.outcome] });
    } catch (error) {
      setResult({ error: true, text: error instanceof Error ? error.message : "Codex reset result is uncertain. Refresh usage before trying again." });
    } finally { setResetting(false); setConfirmOffer(null); }
  };
  if (showAccounts) return <ProviderAccountsPanel provider={provider} name={name} currentId={currentId} onBack={() => setShowAccounts(false)} />;
  return <>
    <div className="mb-3 flex items-center gap-2"><ProviderIcon id={provider} size={22} /><p className="ui-dialog-title flex-1">{name}</p><button type="button" className={control} disabled={loading || resetting} aria-label={t("Refresh usage")} title={t("Refresh usage")} onClick={() => void refresh(provider, true)}><RefreshCw size={13} /></button></div>
    <div className="mb-4 flex min-w-0 items-start gap-2 rounded-[6px] bg-background-3 px-2.5 py-2">
      <UserRound size={14} className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="ui-caption text-text-muted">{t("Account used for this usage")}</p>
        <p className="break-all text-text-secondary">{usage?.account?.email ?? usage?.account?.name ?? (usage?.account?.keyFingerprint ? t("Connected key · {id}", { id: usage.account.keyFingerprint }) : t(loading ? "common.loading" : "Account not provided by the CLI"))}</p>
        {usage?.account?.plan ? <p className="mt-0.5 ui-caption text-text-muted">{usage.account.plan}</p> : null}
      </div>
    </div>
    {usage?.windows.map((window) => <div key={window.id} className="mb-3">
      <div className="mb-1.5 flex justify-between gap-3"><span>{t(usageWindowLabel(window))}</span><span className="tabular-nums">{window.usedPercent == null ? "—" : `${Math.round(window.usedPercent)}%`}</span></div>
      {window.usedPercent != null ? <div role="progressbar" aria-label={t(usageWindowLabel(window))} aria-valuenow={window.usedPercent} aria-valuemin={0} aria-valuemax={100} className="h-1 overflow-hidden rounded-full bg-background-3"><div className="h-full rounded-full bg-text-secondary" style={{ width: `${Math.min(100, window.usedPercent)}%`, background: barColor?.(window.usedPercent) }} /></div> : null}
      {window.resetsAt != null ? <p className="mt-1.5 ui-caption text-text-muted" title={new Date(window.resetsAt).toLocaleString()}>{window.resetsAt > now ? t("Resets in {time}", { time: resetDuration(window.resetsAt, now) ?? "—" }) : t("Window reset time passed. Refresh usage.")}</p> : null}
    </div>)}
    {usage?.note ? <p className="mb-3 text-text-muted">{t(usage.note)}</p> : null}
    {!usage ? <p className="mb-3 text-text-muted">{t("common.loading")}</p> : null}
    {provider === "codex" && (usage?.resetCount ?? 0) > 0 ? <div className="mt-3 border-t border-border-subtle pt-3">
      <p className="font-medium">{t("Available resets: {count}", { count: usage!.resetCount })}</p>
      <p className="mt-1 ui-caption text-text-muted">{t("Uses one earned reset credit. Does not purchase credits or change your plan.")}</p>
      {confirming ? <div className="mt-3 flex gap-2"><button type="button" disabled={loading || resetting} className="rounded-[6px] bg-background-3 px-3 py-2 font-medium disabled:opacity-50" onClick={() => void reset()}>{t("Confirm · use one reset")}</button><button type="button" disabled={resetting} className={control} onClick={() => setConfirmOffer(null)}>{t("common.cancel")}</button></div> : <button type="button" className={`${control} mt-2`} disabled={!usage?.resetOffer || loading || resetting} onClick={() => { setConfirmOffer(usage?.resetOffer ?? null); setResult(null); }}>{t("Use Codex reset")}</button>}
      {!usage?.resetOffer && !resetting ? <p className="mt-1 ui-caption text-text-muted">{t("The CLI must return an available reset's details before it can be used here.")}</p> : null}
    </div> : null}
    {result ? <p role={result.error ? "alert" : "status"} className={`mt-3 ${result.error ? "text-danger" : "text-text-secondary"}`}>{t(result.text)}</p> : null}
    {usage ? <p className="mt-3 ui-caption text-text-muted">{t("Updated {time}", { time: new Date(usage.updatedAt).toLocaleTimeString() })}</p> : null}
    <div className="mt-3 flex flex-col gap-0.5 border-t border-border-subtle pt-2">
      {supportsProviderAccounts(provider) ? <button type="button" className={`${control} w-full justify-start`} onClick={() => setShowAccounts(true)}><Plus size={13} />{t("Add account")}</button> : <p className="px-1 ui-caption text-text-muted">{t("Multiple accounts are not available for this CLI yet.")}</p>}
      <button type="button" className={`${control} w-full justify-start`} onClick={() => { const store = useAppStore.getState(); store.setSettingsSection("providers"); store.setSettingsOpen(true); }}><Settings2 size={13} />{t("sidebarUsage.configure")}</button>
    </div>
  </>;
}
