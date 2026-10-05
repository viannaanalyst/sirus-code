import { Plus, RefreshCw, Settings2 } from "@/components/icons/phosphor";
import { useState } from "react";
import type { AgentProviderId, ProviderUsage } from "@/client/types";
import { ProviderAccountsPanel } from "@/components/ProviderAccountsPanel";
import { activeProviderAccount, supportsProviderAccounts } from "@/lib/provider-accounts";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { orderedUsageWindows, resetDuration, resetOutcomeMessage, usageWindowLabel } from "@/lib/provider-usage";
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
  const account = usage?.account?.email ?? usage?.account?.name ?? (usage?.account?.keyFingerprint ? t("Connected key · {id}", { id: usage.account.keyFingerprint }) : t(loading ? "common.loading" : "Account not provided by the CLI"));
  const locale = useAppStore.getState().settings.locale;
  return <>
    <div className="mb-3 flex items-center gap-2"><ProviderIcon id={provider} size={20} /><p className="ui-dialog-title min-w-0 flex-1 truncate">{name}</p>{usage?.account?.plan ? <span className="shrink-0 rounded-full bg-background-3 px-2 py-0.5 ui-caption capitalize text-text-secondary">{usage.account.plan}</span> : null}<button type="button" className={control} disabled={loading || resetting} aria-label={t("Refresh usage")} title={t("Refresh usage")} onClick={() => void refresh(provider, true)}><RefreshCw size={13} className={loading ? "animate-spin" : undefined} /></button></div>
    <div className="mb-3 flex min-w-0 items-center gap-2 rounded-[10px] bg-background-2 px-2 py-1.5" title={t("Account used for this usage")}>
      <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#5b8cff] to-[#a371f7] ui-caption font-semibold text-white">{(usage?.account?.email ?? usage?.account?.name ?? "?").slice(0, 1).toUpperCase()}</span>
      <span className="min-w-0 flex-1 truncate ui-control text-text-secondary">{account}</span>
    </div>
    {orderedUsageWindows(usage).map((window) => <div key={window.id} className="mb-3 px-0.5">
      <div className="mb-1.5 flex justify-between gap-3"><span className="ui-control font-medium text-text-primary">{t(usageWindowLabel(window))}</span><span className="ui-control tabular-nums text-text-secondary">{window.usedPercent == null ? "—" : `${Math.round(window.usedPercent)}%`}</span></div>
      {window.usedPercent != null ? <div role="progressbar" aria-label={t(usageWindowLabel(window))} aria-valuenow={window.usedPercent} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-background-3"><div className="h-full rounded-full transition-[width] duration-[var(--motion-normal)]" style={{ width: `${Math.max(window.usedPercent > 0 ? 2 : 0, Math.min(100, window.usedPercent))}%`, background: barColor?.(window.usedPercent) ?? (window.usedPercent >= 90 ? "var(--danger)" : window.usedPercent >= 60 ? "var(--warning)" : "var(--success)") }} /></div> : null}
      {window.resetsAt != null ? <p className="mt-1.5 ui-caption text-text-muted" title={new Date(window.resetsAt).toLocaleString(locale)}>{window.resetsAt > now ? t("usagePanel.renews", { when: new Date(window.resetsAt).toLocaleString(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" }), time: resetDuration(window.resetsAt, now) ?? "—" }) : t("Window reset time passed. Refresh usage.")}</p> : null}
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
    <div className="mt-3 flex gap-1.5 border-t border-border-subtle pt-2.5">
      {supportsProviderAccounts(provider) ? <button type="button" className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[8px] bg-background-2 ui-caption text-text-secondary hover:bg-background-3 hover:text-text-primary" onClick={() => setShowAccounts(true)}><Plus size={13} />{t("usagePanel.account")}</button> : null}
      <button type="button" className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[8px] bg-background-2 ui-caption text-text-secondary hover:bg-background-3 hover:text-text-primary" onClick={() => { const store = useAppStore.getState(); store.setSettingsSection("providers"); store.setSettingsOpen(true); }}><Settings2 size={13} />{t("usagePanel.providers")}</button>
    </div>
    {usage ? <p className="mt-2 text-center ui-caption text-text-muted">{t("Updated {time}", { time: new Date(usage.updatedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) })}</p> : null}
  </>;
}
