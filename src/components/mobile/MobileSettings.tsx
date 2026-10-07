import { REMOTE_TOKEN_KEY, deviceName } from "@/client/remote-pairing";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore } from "@/store/app-store";

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
      <section>
        <button type="button" className="mobile-danger" onClick={disconnect}>{t("mobile.disconnect")}</button>
        <p className="mobile-help">{t("mobile.disconnectHelp")}</p>
      </section>
    </div>
  </div>;
}
