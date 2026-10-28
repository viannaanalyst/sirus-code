import { useState } from "react";
import { normalizePairingCode } from "@/client/remote-pairing";
import { Check, LoaderCircle } from "@/components/icons";
import { translate, type Locale } from "@/i18n";
import "@/styles/mobile.css";

/**
 * First screen on a device that is not paired yet (ADR-080/081). The QR code opens
 * this page already paired; a home-screen app, which does not share Safari's storage,
 * types the six digits shown under the QR code instead. The native app (ADR-134) is not
 * served by the Mac, so it also asks for the Mac's address.
 */
export function MobileConnect({ notice, onCode, withAddress = false }: { notice?: string | null; onCode: (code: string, address: string) => Promise<string | null>; withAddress?: boolean }) {
  const locale: Locale = navigator.language.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
  const t = (key: string) => translate(locale, key);
  const [value, setValue] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(notice ?? null);
  const [busy, setBusy] = useState(false);
  const code = normalizePairingCode(value);
  const submit = async () => {
    if (!code || busy || (withAddress && !address.trim())) return;
    setBusy(true);
    setError(await onCode(code, address.trim()));
    setBusy(false);
  };
  return <main className="mobile-connect">
    <img src="/sirus-glyph.png" alt="" width={64} height={64} className="mobile-connect-logo" />
    <h1>{t("mobile.connect.title")}</h1>
    <p className="mobile-connect-intro">{t(withAddress ? "mobile.connect.nativeIntro" : "mobile.connect.intro")}</p>
    <ol className="mobile-connect-steps">
      {["mobile.connect.step1", "mobile.connect.step2", withAddress ? "mobile.connect.nativeStep3" : "mobile.connect.step3"].map((key, index) => <li key={key}><span aria-hidden="true">{index < 2 ? <Check size={12} /> : index + 1}</span>{t(key)}</li>)}
    </ol>
    <form className="mobile-connect-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {withAddress ? <input value={address} onChange={(event) => { setAddress(event.target.value); setError(null); }} inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="https://mac.tailnet.ts.net" aria-label={t("mobile.connect.address")} /> : null}
      <input onFocus={(event) => { const input = event.currentTarget; setTimeout(() => input.scrollIntoView({ block: "center", behavior: "smooth" }), 320); }} value={value} onChange={(event) => { setValue(event.target.value); setError(null); }} inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000 000" aria-label={t("mobile.connect.code")} aria-invalid={error ? true : undefined} />
      <button type="submit" className="mobile-primary" disabled={!code || busy || (withAddress && !address.trim())}>{busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : null}{t("mobile.connect.submit")}</button>
    </form>
    {error ? <p role="alert" className="mobile-connect-error">{error}</p> : null}
    <p className="mobile-help mobile-center">{t("mobile.connect.private")}</p>
  </main>;
}
