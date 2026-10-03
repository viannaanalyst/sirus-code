import { ArrowLeft, Check, LogIn, Plus, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { client } from "@/client";
import type { AgentProviderId, ProviderUsage } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { providerAccounts } from "@/lib/provider-accounts";
import { primaryUsageWindow, resetDuration } from "@/lib/provider-usage";
import { formatUnknownError } from "@/lib/format-error";
import { useAppStore } from "@/store/app-store";

export function ProviderAccountsPanel({ provider, name, currentId, onBack }: { provider: AgentProviderId; name: string; currentId: string; onBack: () => void }) {
  const t = useTranslation();
  const profiles = useAppStore((state) => state.providerAccounts);
  const selected = useAppStore((state) => state.selectedProviderAccounts[provider] ?? "default");
  const paths = useAppStore((state) => state.settings.providerPaths[provider]);
  const accounts = providerAccounts(provider, profiles);
  const key = accounts.map((account) => account.id).join(",");
  const [snapshots, setSnapshots] = useState<Record<string, ProviderUsage>>({});
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const login = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    let current = true;
    setSnapshots({});
    void (async () => {
      for (const id of key.split(",")) {
        if (!current) return;
        try {
          const usage = await client.providerUsage(provider, version > 0, id);
          if (current) setSnapshots((values) => ({ ...values, [id]: usage }));
        } catch (error) { if (current) {
          setError(formatUnknownError(error));
          setSnapshots((values) => ({ ...values, [id]: { provider, providerAccountId: id, status: "error", windows: [], updatedAt: Date.now(), account: null, note: null, resetCount: 0, resetOffer: null } }));
        } }
      }
    })();
    return () => { current = false; };
  }, [key, paths, provider, version]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (login.current) void client.cancelProviderAccountLogin(provider, login.current).catch(() => undefined); }; }, [provider]);
  const signIn = async (id: string) => {
    setBusy(id); setError(null); login.current = id;
    try {
      await client.loginProviderAccount(provider, id);
      if (!alive.current) return;
      const usage = await client.providerUsage(provider, true, id);
      if (!usage.account?.email) throw new Error("The CLI did not confirm the signed-in account. Refresh or try sign-in again.");
      setSnapshots((values) => ({ ...values, [id]: usage }));
      await useAppStore.getState().selectProviderAccount(provider, id);
      setAdding(false); setLabel("");
    } catch (error) { setError(formatUnknownError(error)); }
    finally { login.current = null; setBusy(null); }
  };
  const add = async () => {
    if (!label.trim() || busy) return;
    setBusy("create"); setError(null);
    try {
      const account = await useAppStore.getState().addProviderAccount(provider, label.trim());
      if (alive.current) await signIn(account.id);
    } catch (error) { setError(formatUnknownError(error)); setBusy(null); }
  };
  const select = async (id: string) => {
    setBusy(id); setError(null);
    try { await useAppStore.getState().selectProviderAccount(provider, id); }
    catch (error) { setError(formatUnknownError(error)); }
    finally { setBusy(null); }
  };
  const rowClass = "flex w-full items-center gap-2 rounded-[8px] border px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
  return <div>
    <div className="mb-3 flex items-center gap-2"><button type="button" className="rounded p-1 hover:bg-background-3" aria-label={t("Back")} onClick={onBack}><ArrowLeft size={16} /></button><h3 className="flex-1 ui-dialog-title">{t("{provider} accounts", { provider: name })}</h3><button type="button" aria-label={t("Refresh accounts")} className="rounded p-1 hover:bg-background-3" disabled={!!busy} onClick={() => setVersion((value) => value + 1)}><RefreshCw size={14} /></button></div>
    <p className="mb-3 ui-caption text-text-muted">{t("Each session stays pinned to the account that started it.")}</p>
    <div role="group" aria-label={t("Provider accounts")} className="space-y-2">
      {accounts.map((account) => {
        const usage = snapshots[account.id];
        const window = primaryUsageWindow(usage);
        const identity = usage?.account?.email;
        const ready = !!identity;
        const isCurrent = account.id === currentId;
        const chosen = account.id === selected;
        return <div key={account.id}>
          <button type="button" disabled={!!busy || (!ready && account.id !== "default")} aria-pressed={chosen} className={`${rowClass} ${chosen ? "border-border-strong bg-background-3" : "border-border-subtle hover:bg-background-3"}`} onClick={() => void select(account.id)}>
            <div className="min-w-0 flex-1"><p className="ui-control font-medium">{account.id === "default" ? t("Default account") : account.label}</p><p className="mt-0.5 break-all ui-caption text-text-muted">{identity ? [usage.account?.plan, identity].filter(Boolean).join(" · ") : usage ? t("Account not verified") : t("common.loading")}</p>
              <p className="mt-1 ui-caption text-text-muted">{isCurrent ? t("Account in use") : chosen ? t("Selected for new sessions") : ready ? t("Ready") : ""}{window?.usedPercent != null ? ` · ${Math.round(100 - window.usedPercent)}% ${t("remaining")}` : ""}{window?.resetsAt ? ` · ${resetDuration(window.resetsAt, Date.now())}` : ""}</p>
              {window?.usedPercent != null ? <div className="mt-1.5 h-1 rounded-full bg-background-2" aria-hidden="true"><div className="h-full rounded-full bg-text-muted" style={{ width: `${100 - window.usedPercent}%` }} /></div> : null}
            </div>{chosen ? <Check size={14} className="shrink-0 text-accent" /> : null}
          </button>
          {account.id !== "default" && !ready ? <button type="button" disabled={!!busy} className="mt-1 flex items-center gap-1.5 px-2 py-1 text-text-muted hover:text-text-primary disabled:opacity-50" onClick={() => void signIn(account.id)}><LogIn size={13} />{t("Sign in with browser")}</button> : null}
          {managing && account.id !== "default" ? <RenameAccount id={account.id} provider={provider} label={account.label} disabled={!!busy} onError={setError} /> : null}
        </div>;
      })}
    </div>
    {busy && login.current ? <div className="mt-3"><p role="status" className="text-text-muted">{t("Complete sign-in in your browser.")}</p><button type="button" className="mt-2 rounded px-2 py-1 hover:bg-background-3" onClick={() => void client.cancelProviderAccountLogin(provider, login.current!).catch((error) => setError(formatUnknownError(error)))}>{t("common.cancel")}</button></div> : null}
    {adding ? <form className="mt-3 flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void add(); }}><label htmlFor={`account-name-${provider}`} className="text-text-muted">{t("Account name")}</label><input id={`account-name-${provider}`} autoFocus maxLength={48} value={label} disabled={!!busy} onChange={(event) => setLabel(event.target.value)} className="rounded-[6px] border border-border-subtle bg-background-2 px-2.5 py-2 outline-none focus-visible:border-accent" placeholder={t("Personal or work")} /><p className="ui-caption text-text-muted">{t("The provider signs in to a separate profile. Your default login stays unchanged.")}</p><button type="submit" disabled={!label.trim() || !!busy} className="rounded-[6px] bg-background-3 px-3 py-2 disabled:opacity-50">{t("Sign in with browser")}</button></form> : <button type="button" disabled={!!busy} className="mt-3 flex w-full items-center gap-2 rounded-[6px] px-2 py-2 text-text-muted hover:bg-background-3 disabled:opacity-50" onClick={() => setAdding(true)}><Plus size={15} />{t("Add account")}</button>}
    <button type="button" disabled={!!busy} className="mt-2 w-full rounded-[6px] px-2 py-2 text-left text-text-muted hover:bg-background-3" aria-expanded={managing} onClick={() => setManaging((value) => !value)}>{t("Manage accounts…")}</button>
    {error ? <p role="alert" className="mt-3 text-danger">{t(error)}</p> : null}
  </div>;
}
function RenameAccount({ id, provider, label, disabled, onError }: { id: string; provider: AgentProviderId; label: string; disabled: boolean; onError: (value: string) => void }) {
  const t = useTranslation(); const [name, setName] = useState(label); const [saving, setSaving] = useState(false);
  return <form className="mt-1 flex gap-1" onSubmit={(event) => {
    event.preventDefault(); setSaving(true);
    void useAppStore.getState().renameProviderAccount(provider, id, name).catch((error) => onError(formatUnknownError(error))).finally(() => setSaving(false));
  }}><input aria-label={t("Account name")} value={name} maxLength={48} disabled={disabled || saving} onChange={(event) => setName(event.target.value)} className="min-w-0 flex-1 rounded border border-border-subtle bg-background-2 px-2 py-1 focus-visible:outline-accent" /><button type="submit" disabled={!name.trim() || disabled || saving} className="rounded px-2 py-1 hover:bg-background-3 disabled:opacity-50">{t("common.save")}</button></form>;
}
