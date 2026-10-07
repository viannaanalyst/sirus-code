import { useState } from "react";
import { normalizePairingCode } from "@/client/remote-pairing";
import { Check, LoaderCircle } from "@/components/icons/phosphor";
import { translate, type Locale } from "@/i18n";
import "@/styles/mobile.css";

/**
 * First screen on a device that is not paired yet (ADR-080/081). The QR code opens
 * this page already paired; a home-screen app, which does not share Safari's storage,
 * types the six digits shown under the QR code instead.
 */
export function MobileConnect({ notice, onCode }: { notice?: string | null; onCode: (code: string) => Promise<string | null> }) {
  const locale: Locale = navigator.language.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
  const t = (key: string) => translate(locale, key);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(notice ?? null);
  const [busy, setBusy] = useState(false);
  const code = normalizePairingCode(value);
  const submit = async () => {
    if (!code || busy) return;
    setBusy(true);
    setError(await onCode(code));
    setBusy(false);
  };
  return <main className="mobile-connect">
    <img src="/sirus-glyph.png" alt="" width={64} height={64} className="mobile-connect-logo" />
    <h1>{t("mobile.connect.title")}</h1>
    <p className="mobile-connect-intro">{t("mobile.connect.intro")}</p>
    <ol className="mobile-connect-steps">
      {["mobile.connect.step1", "mobile.connect.step2", "mobile.connect.step3"].map((key, index) => <li key={key}><span aria-hidden="true">{index < 2 ? <Check size={12} /> : index + 1}</span>{t(key)}</li>)}
    </ol>
    <form className="mobile-connect-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <input onFocus={(event) => { const input = event.currentTarget; setTimeout(() => input.scrollIntoView({ block: "center", behavior: "smooth" }), 320); }} value={value} onChange={(event) => { setValue(event.target.value); setError(null); }} inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000 000" aria-label={t("mobile.connect.code")} aria-invalid={error ? true : undefined} />
      <button type="submit" className="mobile-primary" disabled={!code || busy}>{busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : null}{t("mobile.connect.submit")}</button>
    </form>
    {error ? <p role="alert" className="mobile-connect-error">{error}</p> : null}
    <p className="mobile-help mobile-center">{t("mobile.connect.private")}</p>
  </main>;
}
