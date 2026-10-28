import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "@/components/icons";
import type { LoginSummary } from "@/client/types";
import { client } from "@/client";
import { useTranslation } from "@/i18n/use-translation";
import { emptyLoginDraft, loginInput, siteLabel, type LoginDraft } from "@/lib/login-vault";
import { formatUnknownError } from "@/lib/format-error";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Switch } from "@/primitives/Switch";
import { SettingsGroup, SettingsRow } from "./SettingsSection";

const fieldClass = "h-8 w-full rounded-[var(--radius-md)] border border-border-subtle bg-background-1 px-2.5 ui-control text-text-primary outline-none placeholder:text-text-muted focus:border-border-default";

/** Saved browser logins (ADR-186): add, edit, delete and choose which agents may use. Passwords are write-only here. */
export function SavedLoginsSettings() {
  const t = useTranslation();
  const [logins, setLogins] = useState<LoginSummary[] | null>(null);
  const [draft, setDraft] = useState<LoginDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LoginSummary | null>(null);

  const refresh = useCallback(() => client.loginVaultList().then(setLogins, (failure) => { setLogins([]); setError(formatUnknownError(failure)); }), []);
  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    if (!draft) return;
    const input = loginInput(draft);
    if (!input) { setError(t("vault.invalid")); return; }
    try {
      await client.loginVaultSave(input);
      setDraft(null);
      setError(null);
      await refresh();
    } catch (failure) {
      setError(formatUnknownError(failure));
    }
  };

  const toggleAgents = async (login: LoginSummary, enabled: boolean) => {
    setLogins((current) => current?.map((item) => (item.id === login.id ? { ...item, agentUse: enabled } : item)) ?? current);
    try { await client.loginVaultSetAgentUse(login.id, enabled); } catch (failure) { setError(formatUnknownError(failure)); await refresh(); }
  };

  const edit = (login: LoginSummary) => setDraft({ id: login.id, site: login.origin, username: login.username, password: "", totp: "", agentUse: login.agentUse });
  const field = (key: keyof LoginDraft, value: string) => setDraft((current) => (current ? { ...current, [key]: value } : current));

  return <SettingsGroup title={t("vault.title")} card>
    <p className="px-0 pb-2 ui-description text-text-muted">{t("vault.help")}</p>
    {logins?.length === 0 && !draft ? <p className="py-3 ui-description text-text-muted">{t("vault.empty")}</p> : null}
    {logins?.map((login) => <SettingsRow key={login.id} title={siteLabel(login.origin)} description={`${login.username} · ${login.passwordMask}${login.hasTotp ? ` · ${t("vault.hasTotp")}` : ""}`}>
      <div className="flex items-center gap-2">
        <span className="ui-caption text-text-muted">{t(login.agentUse ? "vault.agentsAllowed" : "vault.agentsBlocked")}</span>
        <Switch checked={login.agentUse} label={`${t("vault.agentUse")}: ${siteLabel(login.origin)}`} onChange={(enabled) => void toggleAgents(login, enabled)} />
        <InteractiveButton variant="secondary" glow={false} aria-label={`${t("vault.edit")}: ${siteLabel(login.origin)}`} onClick={() => edit(login)}><Pencil size={14} aria-hidden="true" />{t("vault.edit")}</InteractiveButton>
        <InteractiveButton variant="secondary" glow={false} aria-label={`${t("vault.delete")}: ${siteLabel(login.origin)}`} onClick={() => setPendingDelete(login)}><Trash2 size={14} aria-hidden="true" />{t("vault.delete")}</InteractiveButton>
      </div>
    </SettingsRow>)}
    {draft ? <form className="grid gap-2.5 border-b border-border-subtle py-3" onSubmit={(event) => { event.preventDefault(); void save(); }} autoComplete="off">
      <label className="grid gap-1 ui-caption text-text-secondary">{t("vault.site")}
        <input value={draft.site} onChange={(event) => field("site", event.target.value)} placeholder={t("vault.sitePlaceholder")} className={fieldClass} spellCheck={false} autoCapitalize="off" />
      </label>
      <label className="grid gap-1 ui-caption text-text-secondary">{t("vault.username")}
        <input value={draft.username} onChange={(event) => field("username", event.target.value)} className={fieldClass} spellCheck={false} autoCapitalize="off" data-1p-ignore />
      </label>
      <label className="grid gap-1 ui-caption text-text-secondary">{t("vault.password")}
        <input type="password" value={draft.password} onChange={(event) => field("password", event.target.value)} placeholder={draft.id ? t("vault.passwordKeep") : undefined} className={fieldClass} autoComplete="new-password" data-1p-ignore />
      </label>
      <label className="grid gap-1 ui-caption text-text-secondary">{t("vault.totp")}
        <input value={draft.totp} onChange={(event) => field("totp", event.target.value)} placeholder={draft.id ? t("vault.totpKeep") : undefined} className={`${fieldClass} font-mono`} spellCheck={false} autoCapitalize="off" data-1p-ignore />
        <span className="text-text-muted">{t("vault.totpHelp")}</span>
      </label>
      <div className="flex items-center justify-between gap-4">
        <span className="min-w-0"><span className="block ui-control font-medium text-text-primary">{t("vault.agentUse")}</span><span className="block ui-description text-text-muted">{t("vault.agentUseHelp")}</span></span>
        <Switch checked={draft.agentUse} label={t("vault.agentUse")} onChange={(enabled) => setDraft((current) => (current ? { ...current, agentUse: enabled } : current))} />
      </div>
      <div className="flex gap-2">
        <InteractiveButton type="submit" variant="primary">{t("vault.save")}</InteractiveButton>
        <InteractiveButton type="button" variant="secondary" glow={false} onClick={() => { setDraft(null); setError(null); }}>{t("vault.cancel")}</InteractiveButton>
      </div>
    </form> : null}
    {error ? <p role="alert" className="py-2 ui-caption text-danger">{error}</p> : null}
    {draft ? null : <SettingsRow title={t("vault.add")}>
      <InteractiveButton variant="secondary" glow={false} onClick={() => { setDraft(emptyLoginDraft); setError(null); }}><Plus size={14} aria-hidden="true" />{t("vault.add")}</InteractiveButton>
    </SettingsRow>}
    <ConfirmDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
      title={t("vault.deleteTitle", { site: pendingDelete ? siteLabel(pendingDelete.origin) : "" })} description={t("vault.deleteHelp")}
      confirmLabel={t("vault.delete")} cancelLabel={t("vault.cancel")}
      onConfirm={async () => { if (!pendingDelete) return; try { await client.loginVaultDelete(pendingDelete.id); await refresh(); } catch (failure) { setError(formatUnknownError(failure)); } }} />
  </SettingsGroup>;
}
