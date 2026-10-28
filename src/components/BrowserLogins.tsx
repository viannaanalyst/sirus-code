import { useEffect, useState } from "react";
import { KeyRound, Lock } from "@/components/icons";
import { client } from "@/client";
import type { LoginSummary } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { siteLabel } from "@/lib/login-vault";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/primitives/Dropdown";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { useAppStore } from "@/store/app-store";

/** "Save login for <site>?" after a sign-in in this session's browser (ADR-186). The password never reaches the renderer. */
export function LoginOfferBar({ sessionId }: { sessionId: string }) {
  const t = useTranslation();
  const offer = useAppStore((state) => state.loginPrompts?.offers.find((item) => item.sessionId === sessionId));
  const [busy, setBusy] = useState(false);
  if (!offer) return null;
  const site = siteLabel(offer.origin);
  const answer = async (save: boolean, agentUse: boolean) => {
    if (busy) return;
    setBusy(true);
    await client.loginVaultAnswerOffer(offer.id, save, agentUse).catch((error) => useAppStore.setState({ error: formatUnknownError(error) }));
    setBusy(false);
  };
  const title = t(offer.update ? "offer.update" : "offer.title", { site });
  return <div role="group" aria-label={title} className="mx-2 mt-1.5 flex items-start gap-2.5 rounded-[var(--radius-md)] border border-border-default bg-background-2 px-3 py-2">
    <Lock size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-text-muted" />
    <div className="min-w-0 flex-1">
      <p className="ui-control font-medium text-text-primary">{title}</p>
      <p className="mt-0.5 ui-caption text-text-muted">{t("offer.user", { name: offer.username })}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <InteractiveButton variant="primary" disabled={busy} onClick={() => void answer(true, false)}>{t(offer.update ? "offer.updateAction" : "offer.save")}</InteractiveButton>
        {offer.update ? null : <InteractiveButton variant="secondary" glow={false} disabled={busy} onClick={() => void answer(true, true)}>{t("offer.saveAgents")}</InteractiveButton>}
        <InteractiveButton variant="ghost" disabled={busy} onClick={() => void answer(false, false)}>{t("offer.dismiss")}</InteractiveButton>
      </div>
    </div>
  </div>;
}

/** The key in the address bar: shown only when a saved login matches this page's exact origin. */
export function LoginKeyButton({ sessionId, url, className }: { sessionId: string; url: string | null; className: string }) {
  const t = useTranslation();
  const [matches, setMatches] = useState<LoginSummary[]>([]);
  // Re-read after an offer is answered, so a login saved a moment ago shows up.
  const offers = useAppStore((state) => state.loginPrompts?.offers.length ?? 0);
  useEffect(() => {
    let current = true;
    if (!url || !/^https?:\/\//.test(url)) { setMatches([]); return; }
    void client.loginVaultMatches(url).then((found) => { if (current) setMatches(found); }, () => { if (current) setMatches([]); });
    return () => { current = false; };
  }, [url, offers]);
  if (!matches.length) return null;
  const fail = (error: unknown) => useAppStore.setState({ error: formatUnknownError(error) });
  const fill = (login: LoginSummary, part: "login" | "totp") => void client.loginVaultAutofill(sessionId, login.id, part).catch(fail);
  return <Dropdown>
    <DropdownTrigger asChild>
      <button type="button" title={t("autofill.title")} aria-label={t("autofill.title")} className={className}>
        <KeyRound size={13} aria-hidden="true" />
      </button>
    </DropdownTrigger>
    <DropdownContent align="end" className="min-w-[220px]">
      {matches.map((login) => <div key={login.id}>
        <DropdownItem icon={<KeyRound size={14} />} onSelect={() => fill(login, "login")}>{t("autofill.fill", { name: login.username })}</DropdownItem>
        {login.hasTotp ? <DropdownItem icon={<Lock size={14} />} onSelect={() => fill(login, "totp")}>{t("autofill.code", { name: login.username })}</DropdownItem> : null}
      </div>)}
    </DropdownContent>
  </Dropdown>;
}
