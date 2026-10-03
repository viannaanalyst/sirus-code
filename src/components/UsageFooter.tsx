import { Check, Plus, RefreshCw, UserRound } from "lucide-react";
import { memo, useEffect, useState } from "react";
import type { AgentProviderId, ProviderUsage } from "@/client/types";
import { ProviderAccountsPanel } from "@/components/ProviderAccountsPanel";
import { activeProviderAccount, supportsProviderAccounts } from "@/lib/provider-accounts";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { PROVIDERS } from "@/lib/provider-registry";
import { primaryUsageWindow, resetDuration, resetOutcomeMessage, usageWindowLabel } from "@/lib/provider-usage";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { useAppStore, selectCurrentSessionMeta } from "@/store/app-store";
import { cn } from "@/lib/cn";

const control = "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[6px] px-1.5 text-text-muted hover:bg-background-3 hover:text-text-secondary focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";

function UsageFooterView({ composerAligned = false }: { composerAligned?: boolean }) {
  const t = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const selections = useAppStore((state) => state.selectedProviderAccounts);
  const agents = useAppStore((state) => state.agents);
  const usage = useAppStore((state) => state.usageByProvider);
  const loading = useAppStore((state) => state.usageLoading);
  const refresh = useAppStore((state) => state.refreshProviderUsage);
  const session = useAppStore(selectCurrentSessionMeta);
  const active = session?.agent ?? settings.defaultAgent;
  const eligible = PROVIDERS.filter((provider) => provider.id === active || (!settings.disabledProviders.includes(provider.id) && agents.some((agent) => agent.id === provider.id && agent.installed)));
  const visible = eligible.filter((provider) => settings.usageProviders.includes(provider.id) || provider.id === active);
  const scope = visible.map((provider) => provider.id).join(",");
  const paths = JSON.stringify([settings.providerPaths, visible.map((provider) => activeProviderAccount(provider.id, session, selections))]);
  useEffect(() => {
    const ids = scope.split(",").filter(Boolean) as AgentProviderId[];
    const refreshVisible = () => {
      if (document.visibilityState !== "hidden") for (const provider of ids) void refresh(provider);
    };
    refreshVisible();
    document.addEventListener("visibilitychange", refreshVisible);
    return () => document.removeEventListener("visibilitychange", refreshVisible);
  }, [scope, paths, refresh]);
  const refreshing = visible.some((provider) => loading[provider.id]);

  return <footer className={cn("relative z-10 flex h-[var(--statusbar)] shrink-0 items-center gap-1 ui-caption", composerAligned ? "mx-auto w-full max-w-[var(--chat-column-width)]" : "px-3")} aria-label={t("CLI usage")}>
    <div className="scroll-thin flex min-w-0 items-center gap-1 overflow-x-auto">
      {visible.map((provider) => <UsageChip key={provider.id} provider={provider.id} name={provider.name} active={active} currentId={activeProviderAccount(provider.id, session, selections)} usage={usage[provider.id]} loading={!!loading[provider.id]} />)}
    </div>
    {visible.length > 0 ? <button type="button" className={control} aria-label={t("Refresh usage")} title={t("Refresh usage")} disabled={refreshing} onClick={() => { for (const provider of visible) void refresh(provider.id, true); }}><RefreshCw size={12} /></button> : null}
    <Popover>
      <PopoverTrigger asChild><button type="button" className={control} aria-label={t("Show provider usage")} title={t("Show provider usage")}><Plus size={13} /></button></PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} className="usage-popover w-64 p-2">
        <p className="px-2 py-1 text-text-muted">{t("Show provider usage")}</p>
        <ProviderVisibilityList active={active} eligible={eligible} />
      </PopoverContent>
    </Popover>
  </footer>;
}

function ProviderVisibilityList({ active, eligible }: { active: AgentProviderId; eligible: (typeof PROVIDERS)[number][] }) {
  const t = useTranslation();
  const pins = useAppStore((state) => state.settings.usageProviders);
  return <div>
    {eligible.map((provider) => <button key={provider.id} type="button" role="checkbox" aria-checked={pins.includes(provider.id) || provider.id === active} disabled={provider.id === active} className="flex w-full items-center gap-2 rounded-[6px] px-2 py-2 text-left hover:bg-background-3 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60" onClick={() => {
      const store = useAppStore.getState();
      const current = store.settings.usageProviders;
      void store.saveSettings({ ...store.settings, usageProviders: current.includes(provider.id) ? current.filter((id) => id !== provider.id) : [...current, provider.id] });
    }}><ProviderIcon id={provider.id} size={18} /><span className="flex-1">{provider.name}</span>{provider.id === active ? <span className="ui-caption text-text-muted">{t("Current provider")}</span> : null}{pins.includes(provider.id) || provider.id === active ? <Check size={14} /> : null}</button>)}
    <p className="px-2 pt-2 ui-caption text-text-muted">{t("The current provider is always shown.")}</p>
  </div>;
}

function UsageChip({ provider, name, active, currentId, usage, loading }: { provider: AgentProviderId; name: string; active: AgentProviderId; currentId: string; usage: ProviderUsage | undefined; loading: boolean }) {
  const t = useTranslation();
  const [confirmOffer, setConfirmOffer] = useState<string | null>(null);
  const [result, setResult] = useState<{ error: boolean; text: string } | null>(null);
  const [resetting, setResetting] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const refresh = useAppStore((state) => state.refreshProviderUsage);
  const main = primaryUsageWindow(usage);
  const now = Date.now();
  const used = main?.usedPercent;
  const countdown = resetDuration(main?.resetsAt ?? null, now);
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
  return <Popover onOpenChange={(open) => { if (open) void refresh(provider); else { setConfirmOffer(null); setShowAccounts(false); } }}>
    <PopoverTrigger asChild><button type="button" className={`${control} tabular-nums`} aria-label={t("Usage · {provider}", { provider: name })} title={provider === active ? t("Current provider · {provider}", { provider: name }) : name}>
      <ProviderIcon id={provider} size={12} className="bg-transparent" />
      <span>{name}</span>
      {used != null ? <><span className="h-1 w-10 overflow-hidden rounded-full bg-background-3" aria-hidden="true"><span className="block h-full rounded-full bg-text-muted" style={{ width: `${used}%` }} /></span><span>{Math.round(used)}%</span>{countdown ? <span>{countdown}</span> : null}</> : <span>{loading ? t("common.loading") : t("Usage unavailable")}</span>}
    </button></PopoverTrigger>
    <PopoverContent side="top" align="start" sideOffset={8} className="usage-popover scroll-thin max-h-[min(520px,70vh)] w-80 overflow-y-auto p-3" aria-label={t("Usage · {provider}", { provider: name })}>
      {showAccounts ? <ProviderAccountsPanel provider={provider} name={name} currentId={currentId} onBack={() => setShowAccounts(false)} /> : <>
      <div className="mb-3 flex items-center gap-2"><ProviderIcon id={provider} size={22} /><div className="flex-1"><p className="ui-dialog-title">{name}</p><p className="ui-description text-text-muted">{t(provider === active ? "Current provider" : "Monitored provider")}</p></div><button type="button" className={control} disabled={loading || resetting} aria-label={t("Refresh usage")} onClick={() => void refresh(provider, true)}><RefreshCw size={13} /></button></div>
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
        {window.usedPercent != null ? <div role="progressbar" aria-label={t(usageWindowLabel(window))} aria-valuenow={window.usedPercent} aria-valuemin={0} aria-valuemax={100} className="h-1 overflow-hidden rounded-full bg-background-3"><div className="h-full rounded-full bg-text-secondary" style={{ width: `${window.usedPercent}%` }} /></div> : null}
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
      <div className="mt-3 border-t border-border-subtle pt-2">
        {supportsProviderAccounts(provider) ? <button type="button" className={`${control} w-full justify-start`} onClick={() => setShowAccounts(true)}><Plus size={13} />{t("Add account")}</button> : <p className="px-1 ui-caption text-text-muted">{t("Multiple accounts are not available for this CLI yet.")}</p>}
      </div>
      </>}
    </PopoverContent>
  </Popover>;
}

/** Memoized: streamed output re-renders the transcript, not this control. */
export const UsageFooter = memo(UsageFooterView);
