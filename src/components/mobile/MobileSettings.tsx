import { useEffect, useState } from "react";
import { REMOTE_TOKEN_KEY, deviceName } from "@/client/remote-pairing";
import { disablePush, enablePush, pushEnabled, pushSupport } from "@/client/remote-push";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { Switch } from "@/primitives/Switch";
import { useAppStore } from "@/store/app-store";
import { MobileUsage } from "./MobileUsage";

/** Alerts from the Mac (ADR-082): explains what is missing, or offers the switch. */
function AlertsSection() {
  const t = useTranslation();
  const support = pushSupport();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (support === "ready") void pushEnabled().then(setOn); }, [support]);
  const toggle = async (next: boolean) => {
    const token = window.localStorage.getItem(REMOTE_TOKEN_KEY);
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (next) setOn(await enablePush(token));
      else { await disablePush(token); setOn(false); }
    } catch (reason) {
      setError(formatUnknownError(reason));
    } finally {
      setBusy(false);
    }
  };
  return <section>
    <h2>{t("mobile.alerts")}</h2>
    <div className="mobile-card">
      <div className="mobile-setting">
        <span><span className="mobile-option-title">{t("mobile.alertsSwitch")}</span><br /><span className="mobile-option-help">{t("mobile.alertsKinds")}</span></span>
        <Switch checked={on} disabled={support !== "ready" || busy} onChange={(value) => void toggle(value)} label={t("mobile.alertsSwitch")} />
      </div>
    </div>
    {support !== "ready" ? <p className="mobile-help">{t(`mobile.alerts.${support}`)}</p> : null}
    {error ? <p role="alert" className="mobile-help text-danger">{error}</p> : null}
  </section>;
}

/** What this phone is connected to, and how to leave. Mac-wide preferences stay on the Mac. */
export function MobileSettings({ online }: { online: boolean }) {
  const t = useTranslation();
  const host = useAppStore((state) => state.hostInfo);
  const disconnect = () => {
    window.localStorage.removeItem(REMOTE_TOKEN_KEY);
    window.location.replace("/");
  };
  return <div className="mobile-page">
    <header className="mobile-header mobile-header-large"><div><h1>{t("mobile.settings")}</h1></div></header>
    <div className="mobile-scroll mobile-form">
      <section>
        <h2>{t("mobile.connection")}</h2>
        <div className="mobile-card">
          <div className="mobile-setting">
            <span className="mobile-option-title">{t("mobile.mac")}</span>
            <span className="mobile-host" data-online={online || undefined}><span>{online ? t("mobile.connected") : t("mobile.reconnecting")}</span></span>
          </div>
          {host?.shell ? <div className="mobile-setting"><span className="mobile-option-title">Shell</span><span className="mobile-option-help">{host.shell}</span></div> : null}
          <div className="mobile-setting">
            <span className="mobile-option-title">{t("mobile.thisDevice")}</span>
            <span className="mobile-option-help">{deviceName(navigator.userAgent)}</span>
          </div>
        </div>
        <p className="mobile-help">{t("mobile.installHelp")}</p>
      </section>
      <AlertsSection />
      <MobileUsage />
      <section>
        <button type="button" className="mobile-danger" onClick={disconnect}>{t("mobile.disconnect")}</button>
        <p className="mobile-help">{t("mobile.disconnectHelp")}</p>
      </section>
    </div>
  </div>;
}
