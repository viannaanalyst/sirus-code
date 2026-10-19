import { useEffect, useState } from "react";
import type { CookieDomain, CookieImportReport, CookieImportSource } from "@/client/types";
import { client } from "@/client";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { useTranslation } from "@/i18n/use-translation";
import { canReviewSelection, filterDomains, initialSelection, isFullDiskAccessError, selectedCookieCount, selectedDomains, toggleDomain } from "@/lib/cookie-import";
import { formatUnknownError } from "@/lib/format-error";
import { InteractiveButton } from "@/primitives/InteractiveButton";

type Step = "source" | "domains" | "consent" | "done";

/**
 * Imports cookies from Chrome or Safari into one saved browser profile (ADR-152). Nothing is read
 * beyond the source list until a source is picked, nothing is imported until the consent step's
 * button is pressed, and the domains are the only thing the owner chooses.
 */
export function CookieImportDialog({ open, onOpenChange, profileId, profileName }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: string;
  profileName: string;
}) {
  const t = useTranslation();
  const [step, setStep] = useState<Step>("source");
  const [sources, setSources] = useState<CookieImportSource[] | null>(null);
  const [source, setSource] = useState<CookieImportSource | null>(null);
  const [domains, setDomains] = useState<CookieDomain[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(initialSelection);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [report, setReport] = useState<CookieImportReport | null>(null);

  useEffect(() => {
    let alive = true;
    client.browserCookieSources().then(
      (list) => { if (alive) setSources(list); },
      (failure: unknown) => { if (alive) setError(failure); },
    );
    return () => { alive = false; };
  }, []);

  const pickSource = (picked: CookieImportSource) => {
    setSource(picked);
    setDomains(null);
    setSelected(initialSelection());
    setQuery("");
    setError(null);
    setStep("domains");
    client.browserCookieDomains(picked.id).then(setDomains, (failure: unknown) => setError(failure));
  };

  const importNow = async () => {
    if (!source || !domains) return;
    setBusy(true);
    setError(null);
    try {
      setReport(await client.browserCookieImport(profileId, source.id, selectedDomains(domains, selected)));
      setStep("done");
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  const sourceLabel = source
    ? source.browser === "safari" ? t("cookies.sourceSafari") : t("cookies.sourceChrome", { profile: source.profile })
    : "";
  const chosen = domains ? selectedDomains(domains, selected) : [];
  const shownDomains = domains ? filterDomains(domains, query) : [];
  const titles: Record<Step, [string, string?]> = {
    source: [t("cookies.dialogTitle", { profile: profileName }), t("cookies.sourceHelp")],
    domains: [t("cookies.domainsTitle"), t("cookies.domainsHelp")],
    consent: [t("cookies.consentTitle")],
    done: [t("cookies.doneTitle")],
  };
  const [title, description] = titles[step];
  const errorText = error && isFullDiskAccessError(error) ? t("cookies.fullDiskAccess") : error ? formatUnknownError(error) : null;

  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <DialogContent title={title} description={description} className="w-[min(460px,calc(100vw-32px))]">
      {step === "source" && <div className="flex flex-col gap-2">
        {sources === null && !error && <p className="ui-description text-text-muted">{t("cookies.loading")}</p>}
        {sources?.length === 0 && <p className="ui-description text-text-muted">{t("cookies.noSources")}</p>}
        {sources?.map((item) => <button key={item.id} type="button" onClick={() => pickSource(item)}
          className="flex w-full items-center rounded-[var(--radius-md)] border border-border-subtle px-3 py-2 text-left ui-control text-text-primary hover:border-border-default hover:bg-background-3/60">
          {item.browser === "safari" ? t("cookies.sourceSafari") : t("cookies.sourceChrome", { profile: item.profile })}
        </button>)}
      </div>}

      {step === "domains" && <div className="flex flex-col gap-3">
        {domains === null && !error && <p className="ui-description text-text-muted">{t("cookies.loading")}</p>}
        {domains?.length === 0 && <p className="ui-description text-text-muted">{t("cookies.domainsEmpty")}</p>}
        {domains && domains.length > 0 && <>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("cookies.domainsSearch")} aria-label={t("cookies.domainsSearch")}
            className="h-8 w-full rounded-[var(--radius-md)] border border-border-subtle bg-background-1 px-2.5 ui-control text-text-primary outline-none placeholder:text-text-muted focus:border-border-default" />
          <ul className="max-h-[280px] overflow-y-auto">
            {shownDomains.map((item) => <li key={item.domain}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-1 py-1.5 ui-control hover:bg-background-3/60">
                <input type="checkbox" checked={selected.has(item.domain)} onChange={() => setSelected((previous) => toggleDomain(previous, item.domain))} className="size-3.5 accent-accent" />
                <span className="min-w-0 flex-1 truncate text-text-primary">{item.domain}</span>
                <span className="ui-caption text-text-muted">{t("cookies.cookieCount", { count: item.count })}</span>
              </label>
            </li>)}
          </ul>
          {shownDomains.length === 0 && <p className="ui-caption text-text-muted">{t("cookies.domainsNoMatch")}</p>}
        </>}
      </div>}

      {step === "consent" && <div className="flex flex-col gap-3 ui-description text-text-secondary">
        <p>{t("cookies.consentBody", { source: sourceLabel, target: profileName })}</p>
        <p className="ui-caption text-text-muted">{t("cookies.consentDomains", { count: chosen.length })}</p>
        <ul className="max-h-[180px] overflow-y-auto rounded-[var(--radius-md)] border border-border-subtle px-3 py-2">
          {chosen.map((domain) => <li key={domain} className="truncate ui-control text-text-primary">{domain}</li>)}
        </ul>
        <p className="ui-caption text-text-muted">{t("cookies.cookieCount", { count: selectedCookieCount(domains ?? [], selected) })}</p>
        <p className="ui-caption text-text-muted">{t("cookies.consentNote")}</p>
      </div>}

      {step === "done" && report && <p className="ui-description text-text-secondary">
        {t("cookies.doneBody", { imported: report.imported, skipped: report.skipped })}
      </p>}

      {errorText && <div role="alert" className="mt-3 flex flex-col items-start gap-2">
        <p className="ui-caption text-danger">{errorText}</p>
        {isFullDiskAccessError(error) && <InteractiveButton variant="secondary" glow={false} onClick={() => void client.browserOpenFullDiskAccess()}>
          {t("cookies.openPrivacy")}
        </InteractiveButton>}
      </div>}

      <div className="mt-5 flex justify-end gap-2">
        {step === "domains" && <>
          <InteractiveButton variant="ghost" onClick={() => { setError(null); setStep("source"); }}>{t("cookies.back")}</InteractiveButton>
          <InteractiveButton variant="primary" glow={false} disabled={!canReviewSelection(selected) || !domains} onClick={() => setStep("consent")}>
            {t("cookies.continue")}
          </InteractiveButton>
        </>}
        {step === "consent" && <>
          <InteractiveButton variant="ghost" disabled={busy} onClick={() => { setError(null); setStep("domains"); }}>{t("cookies.back")}</InteractiveButton>
          <InteractiveButton variant="primary" glow={false} loading={busy} disabled={busy} onClick={() => void importNow()}>
            {busy ? t("cookies.importing") : t("cookies.import")}
          </InteractiveButton>
        </>}
        {step === "done" && <InteractiveButton variant="primary" glow={false} onClick={() => onOpenChange(false)}>{t("cookies.close")}</InteractiveButton>}
      </div>
    </DialogContent>
  </Dialog>;
}
