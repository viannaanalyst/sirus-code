import { useEffect, useState } from "react";
import { client } from "@/client";
import type { ProviderUsage, Session } from "@/client/types";
import { LoaderCircle, Users } from "@/components/icons";
import { useTranslation } from "@/i18n/use-translation";
import { cascadeIndex, useCascade } from "@/lib/cascade";
import { formatUnknownError } from "@/lib/format-error";
import { accountChoices, providerAccounts, supportsProviderAccounts, type AccountChoice } from "@/lib/provider-accounts";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { useAppStore } from "@/store/app-store";

/**
 * "Continue on another account" in the usage-limit notice (ADR-063 amendment): lists the
 * provider's other accounts with their remaining quota and plan, and moves the conversation to
 * the one picked, which then continues where it stopped. Shown only when one of them is signed
 * in with quota left.
 */
export function UsageLimitAccountPicker({ session, disabled }: { session: Session; disabled: boolean }) {
  const t = useTranslation();
  const profiles = useAppStore((state) => state.providerAccounts);
  const provider = session.agent;
  const current = session.providerAccountId ?? "default";
  const others = supportsProviderAccounts(provider) ? providerAccounts(provider, profiles).filter((account) => account.id !== current) : [];
  const key = others.map((account) => account.id).join(",");
  const [usage, setUsage] = useState<Record<string, ProviderUsage>>({});
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cascade = useCascade(open);
  // Cached reads (60 s) of the other accounts; one at a time, as the accounts panel does.
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const id of key ? key.split(",") : []) {
        try {
          const read = await client.providerUsage(provider, false, id);
          if (!alive) return;
          setUsage((values) => ({ ...values, [id]: read }));
        } catch { /* An unread account is listed but cannot be picked. */ }
      }
    })();
    return () => { alive = false; };
  }, [key, provider]);
  const choices = accountChoices(provider, current, profiles, usage);
  if (!choices.some((choice) => choice.eligible)) return null;
  const pick = async (choice: AccountChoice) => {
    if (busy || !choice.eligible) return;
    setBusy(choice.account.id);
    setError(null);
    try {
      await useAppStore.getState().continueOnAccount(session.id, choice.account.id);
      setOpen(false);
    } catch (cause) {
      setError(formatUnknownError(cause));
    } finally {
      setBusy(null);
    }
  };
  const label = (choice: AccountChoice) => choice.account.id === "default" ? t("Default account") : choice.account.label;
  const detail = (choice: AccountChoice) => {
    if (busy === choice.account.id) return t("usageLimit.moving");
    if (!usage[choice.account.id]) return t("common.loading");
    if (!usage[choice.account.id]?.account?.email) return t("Account not verified");
    const quota = choice.remaining == null ? t("usageLimit.quotaUnknown") : choice.remaining === 0 ? t("usageLimit.noQuota") : t("usageLimit.remaining", { percent: choice.remaining });
    return [choice.plan, quota].filter(Boolean).join(" · ");
  };
  return <Popover open={open} onOpenChange={(next) => { if (!busy) { setOpen(next); if (!next) setError(null); } }}>
    <PopoverTrigger asChild>
      <button type="button" disabled={disabled} title={t("usageLimit.otherAccountHint")} className="usage-limit-action ui-caption">
        <Users size={13} aria-hidden="true" />{t("usageLimit.otherAccount")}
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" align="end" sideOffset={8} className="usage-limit-accounts w-[280px]">
      <div data-cascade={cascade ? "" : undefined}>
        <p className="px-2 pb-1 pt-1.5 ui-caption text-text-muted">{t("usageLimit.otherAccountTitle")}</p>
        <div role="group" aria-label={t("usageLimit.otherAccount")} aria-busy={Boolean(busy)}>
          {choices.map((choice, index) => <button key={choice.account.id} type="button" data-cascade-item="" style={cascadeIndex(index)}
            disabled={!choice.eligible || Boolean(busy)} className="usage-limit-account" onClick={() => void pick(choice)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate ui-control text-text-primary">{label(choice)}</span>
              <span className="block truncate ui-caption text-text-muted" role={busy === choice.account.id ? "status" : undefined}>{detail(choice)}</span>
            </span>
            {busy === choice.account.id ? <LoaderCircle size={14} className="shrink-0 animate-spin text-text-muted" aria-hidden="true" />
              : choice.remaining != null ? <span className="usage-limit-account-meter" aria-hidden="true"><span style={{ width: `${choice.remaining}%` }} /></span> : null}
          </button>)}
        </div>
        {error ? <p role="alert" className="px-2 pb-1.5 pt-1 ui-caption text-danger">{t(error)}</p> : null}
      </div>
    </PopoverContent>
  </Popover>;
}
