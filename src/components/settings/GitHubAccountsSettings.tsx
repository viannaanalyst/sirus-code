import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "@/client";
import type { GitHubAccount, GitHubAccountResponse } from "@/client/types";
import { Check, Copy, LogOut, Plus } from "@/components/icons";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { IconButton } from "@/primitives/IconButton";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { ConnectorLogo } from "./ConnectorsSettings";
import { SettingsGroup } from "./SettingsSection";

type Accounts = { accounts: GitHubAccount[]; missing: boolean };
const accountsOf = (response: GitHubAccountResponse): Accounts | null => response.type === "accounts" ? { accounts: response.accounts, missing: response.missing } : null;

/**
 * Settings → Git: the GitHub CLI's accounts on github.com (ADR-188). One is active; Use this
 * account switches, Sign out forgets one, and Add account runs GitHub's device flow (a one-time
 * code to enter on github.com) while this section waits.
 */
export function GitHubAccountsSettings() {
  const t = useTranslation();
  const [state, setState] = useState<Accounts | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<{ code: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [signingOut, setSigningOut] = useState<string | null>(null);
  const alive = useRef(true);

  const run = useCallback(async (key: string, action: Parameters<typeof client.githubAccountAction>[0]) => {
    setBusy(key);
    setError(null);
    const ok = await client.githubAccountAction(action).then((response) => {
      const next = accountsOf(response);
      if (next && alive.current) setState(next);
      return true;
    }, (cause: unknown) => {
      if (alive.current) setError(formatUnknownError(cause));
      return false;
    });
    if (alive.current) setBusy(null);
    return ok;
  }, []);

  useEffect(() => {
    alive.current = true;
    void run("list", { type: "list" });
    return () => {
      alive.current = false;
      // Leaving Settings mid sign-in stops the waiting `gh auth login`.
      void client.githubAccountAction({ type: "loginCancel" }).catch(() => undefined);
    };
  }, [run]);

  const add = async () => {
    setError(null);
    setBusy("add");
    await signIn().catch((cause: unknown) => { if (alive.current) setError(formatUnknownError(cause)); });
    if (alive.current) { setDevice(null); setBusy(null); }
    // Whatever happened, show the accounts as GitHub CLI now has them.
    const now = accountsOf(await client.githubAccountAction({ type: "list" }).catch(() => ({ type: "done" as const })));
    if (now && alive.current) setState(now);
  };
  const signIn = async () => {
    const response = await client.githubAccountAction({ type: "loginStart" });
    if (response.type !== "loginCode" || !alive.current) return;
    setDevice({ code: response.code, url: response.url });
    setCopied(false);
    const finished = accountsOf(await client.githubAccountAction({ type: "loginWait" }));
    if (finished && alive.current) setState(finished);
  };
  const cancel = () => { void client.githubAccountAction({ type: "loginCancel" }).catch(() => undefined); };
  const copy = (code: string) => {
    void navigator.clipboard.writeText(code).then(() => { if (alive.current) setCopied(true); }).catch(() => undefined);
  };

  const accounts = state?.accounts ?? [];
  return <SettingsGroup title={t("githubAccounts.title")} card>
    <div className="github-accounts">
      <p className="github-accounts-help">{t("githubAccounts.help")}</p>
      {state?.missing ? <p className="github-accounts-note">{t("githubAccounts.missing")}</p>
        : state && !accounts.length && !device ? <p className="github-accounts-note">{t("githubAccounts.none")}</p> : null}
      {accounts.map((account) => <div key={account.login} className="github-account" data-active={account.active || undefined}>
        <ConnectorLogo catalogId="github" name="GitHub" size={26} />
        <span className="github-account-login">{account.login}</span>
        {!account.valid ? <span className="github-account-expired">{t("githubAccounts.expired")}</span> : null}
        <span className="flex-1" />
        {account.active ? <span className="github-account-active"><Check size={12} aria-hidden="true" />{t("githubAccounts.active")}</span>
          : <InteractiveButton variant="secondary" disabled={busy !== null} onClick={() => void run(`switch:${account.login}`, { type: "switch", login: account.login })}>{t("githubAccounts.use")}</InteractiveButton>}
        <IconButton label={t("githubAccounts.signOut")} disabled={busy !== null} onClick={() => setSigningOut(account.login)} className="size-7 min-h-0 rounded-[6px] p-0 text-text-muted"><LogOut size={14} /></IconButton>
      </div>)}
      {device ? <div className="github-device" role="status">
        <span className="github-device-label">{t("githubAccounts.code")}</span>
        <div className="github-device-code-row">
          <code className="github-device-code">{device.code}</code>
          <IconButton label={t(copied ? "githubAccounts.copied" : "githubAccounts.copy")} onClick={() => copy(device.code)} className="size-7 min-h-0 rounded-[6px] p-0 text-text-muted">{copied ? <Check size={14} /> : <Copy size={14} />}</IconButton>
        </div>
        <p className="github-accounts-help">{t("githubAccounts.codeHelp")}</p>
        <div className="github-device-actions">
          <InteractiveButton variant="primary" onClick={() => { copy(device.code); void client.openExternalUrl(device.url).catch(() => undefined); }}>{t("githubAccounts.open")}</InteractiveButton>
          <span className="github-device-waiting">{t("githubAccounts.waiting")}</span>
          <span className="flex-1" />
          <InteractiveButton variant="ghost" onClick={cancel}>{t("githubAccounts.cancel")}</InteractiveButton>
        </div>
      </div> : state && !state.missing ? <div>
        <InteractiveButton variant="secondary" disabled={busy !== null} onClick={() => void add()}><Plus size={14} aria-hidden="true" />{t("githubAccounts.add")}</InteractiveButton>
      </div> : null}
      {error ? <p role="alert" className="github-accounts-error">{error}</p> : null}
    </div>
    <ConfirmDialog open={signingOut !== null} onOpenChange={(open) => { if (!open) setSigningOut(null); }}
      title={t("githubAccounts.signOutTitle", { login: signingOut ?? "" })} description={t("githubAccounts.signOutHelp")} confirmLabel={t("githubAccounts.signOut")}
      busy={busy?.startsWith("logout") ?? false}
      onConfirm={async () => signingOut ? run(`logout:${signingOut}`, { type: "logout", login: signingOut }) : true} />
  </SettingsGroup>;
}
