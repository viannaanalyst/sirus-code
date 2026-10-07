import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, LoaderCircle, RefreshCw, ShieldCheck, Smartphone } from "@/components/icons/phosphor";
import { client } from "@/client";
import type { RemoteAction, RemotePairing, RemoteStatus } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { newlyPaired, pairingCountdown, svgDataUrl } from "@/lib/remote-connections";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Switch } from "@/primitives/Switch";
import { SettingsGroup, SettingsRow, SettingsSection } from "./SettingsSection";
import "@/styles/general-settings.css";
import "@/styles/connections.css";

/** Settings → Connections (ADR-080): remote access switch, pairing QR code and paired devices. */
export function ConnectionsSettings({ locale }: { locale: string }) {
  const t = useTranslation();
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [pairing, setPairing] = useState<RemotePairing | null>(null);
  const [paired, setPaired] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const devices = useRef<RemoteStatus["devices"]>([]);

  const apply = useCallback((next: RemoteStatus) => {
    const joined = newlyPaired(devices.current, next.devices);
    devices.current = next.devices;
    setStatus(next);
    // A device that just scanned the code closes it and is named.
    if (joined) { setPaired(joined.name); setPairing(null); }
  }, []);
  const refresh = useCallback(() => client.remoteAction({ type: "status" }).then(apply, (reason: unknown) => setError(formatUnknownError(reason))), [apply]);

  useEffect(() => {
    void refresh();
    // Tailscale may come up while the page is open.
    window.addEventListener("focus", refresh);
    const stop = client.onRemoteChanged(() => { void refresh(); });
    return () => { window.removeEventListener("focus", refresh); void stop.then((unlisten) => unlisten()); };
  }, [refresh]);

  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await work(); } catch (reason) { setError(formatUnknownError(reason)); } finally { setBusy(false); }
  };
  const setEnabled = (enabled: boolean) => run(async () => {
    apply(await client.remoteAction({ type: "setEnabled", enabled }));
    if (!enabled) setPairing(null);
  });
  const showCode = () => run(async () => {
    setPaired(null);
    const next = await client.remotePair();
    setNow(Date.now());
    setPairing(next);
  });
  const act = (action: RemoteAction) => run(async () => apply(await client.remoteAction(action)));
  const copy = (url: string) => {
    void navigator.clipboard.writeText(url).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }, (reason: unknown) => setError(formatUnknownError(reason)));
  };

  const dates = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const times = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const enabled = !!status?.enabled;
  const url = status?.urls[0];
  const https = status?.https;
  const countdown = pairing ? pairingCountdown(pairing.expiresAt, now) : null;

  return <SettingsSection title={t("connections.title")} description={t("connections.intro")}>
    <div className="general-settings">
      <SettingsGroup title={t("connections.access")} card>
        <SettingsRow title={t("connections.enable")} description={t("connections.enableHelp")}>
          <Switch checked={enabled} disabled={!status || busy} onChange={(value) => void setEnabled(value)} label={t("connections.enable")} />
        </SettingsRow>
        {enabled ? <SettingsRow title={t("connections.keepAwake")} description={t("connections.keepAwakeHelp")}>
          <Switch checked={!!status?.keepAwake} disabled={busy} onChange={(value) => void act({ type: "setKeepAwake", enabled: value })} label={t("connections.keepAwake")} />
        </SettingsRow> : null}
        {enabled ? url
          ? <SettingsRow title={t("connections.address")} description={t("connections.addressHelp")}>
            <code className="connections-address ui-caption">{url}</code>
            <InteractiveButton variant="toolbar" aria-label={t("connections.copy")} onClick={() => copy(url)}>
              {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? t("connections.copied") : null}
            </InteractiveButton>
          </SettingsRow>
          : <SettingsRow title={t("connections.noTailscale")} description={t("connections.noTailscaleHelp")}>
            <InteractiveButton variant="toolbar" aria-label={t("connections.checkAgain")} onClick={() => void refresh()}><RefreshCw size={14} aria-hidden="true" /></InteractiveButton>
          </SettingsRow> : null}
        {enabled && https?.available ? <SettingsRow title={t("connections.https")} description={t(https.url ? "connections.httpsOn" : "connections.httpsHelp")}>
          {https.url
            ? <InteractiveButton variant="toolbar" className="text-danger hover:text-danger" disabled={busy} onClick={() => void act({ type: "disableHttps" })}>{t("connections.httpsOff")}</InteractiveButton>
            : <InteractiveButton variant="secondary" glow={false} disabled={busy} onClick={() => void act({ type: "enableHttps" })}>{busy ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <ShieldCheck size={14} aria-hidden="true" />}{t("connections.httpsEnable")}</InteractiveButton>}
        </SettingsRow> : null}
        {enabled && https?.setupUrl && !https.url ? <SettingsRow title={t("connections.httpsSetup")} description={t("connections.httpsSetupHelp")}>
          <InteractiveButton variant="secondary" glow={false} onClick={() => void act({ type: "openHttpsSetup" })}>{t("connections.httpsOpenSetup")}</InteractiveButton>
          <InteractiveButton variant="toolbar" disabled={busy} onClick={() => void act({ type: "enableHttps" })}>{t("connections.checkAgain")}</InteractiveButton>
        </SettingsRow> : null}
      </SettingsGroup>
      {status?.error || error || (https?.error && !https.setupUrl) ? <p role="alert" className="-mt-6 mb-8 ui-caption text-warning">{error ?? status?.error ?? https?.error}</p> : null}

      {enabled && url ? <SettingsGroup title={t("connections.connect")} card>
        <div className="connections-pair settings-row">
          <ol className="connections-steps ui-description">
            <li>{t("connections.step1")}</li>
            <li>{t("connections.step2")}</li>
            <li>{t("connections.step3")}</li>
          </ol>
          {pairing ? <div className="connections-qr" data-expired={countdown ? undefined : ""}>
            <img src={svgDataUrl(pairing.qrSvg)} alt={t("connections.qrLabel")} width={168} height={168} />
            <p className="connections-code" aria-label={t("connections.codeLabel", { code: pairing.code })}>{pairing.code.slice(0, 3)} {pairing.code.slice(3)}</p>
            <p className="ui-caption text-text-muted" aria-live="polite">{countdown ? t("connections.expiresIn", { time: countdown }) : t("connections.expired")}</p>
            <div className="flex gap-2">
              <InteractiveButton variant="toolbar" disabled={busy} onClick={() => void showCode()}><RefreshCw size={14} aria-hidden="true" />{t("connections.newCode")}</InteractiveButton>
              <InteractiveButton variant="toolbar" onClick={() => setPairing(null)}>{t("connections.hideQr")}</InteractiveButton>
            </div>
          </div> : <div className="connections-qr-start">
            {paired ? <p className="connections-paired ui-control" role="status"><Check size={14} aria-hidden="true" />{t("connections.paired", { name: paired })}</p> : null}
            <InteractiveButton variant="secondary" glow={false} disabled={busy} onClick={() => void showCode()}>{t("connections.showQr")}</InteractiveButton>
          </div>}
        </div>
      </SettingsGroup> : null}

      <SettingsGroup title={t("connections.devices")} card>
        {status?.devices.length ? status.devices.map((device) => (
          <SettingsRow key={device.id} title={device.name} description={(device.lastSeen
            ? t("connections.deviceSeen", { date: dates.format(new Date(device.createdAt)), seen: times.format(new Date(device.lastSeen)) })
            : t("connections.deviceAdded", { date: dates.format(new Date(device.createdAt)) })) + (device.push ? ` · ${t("connections.alertsOn")}` : "")}>
            {device.push ? <InteractiveButton variant="toolbar" disabled={busy} onClick={() => void act({ type: "testPush", deviceId: device.id })}>{t("connections.testAlert")}</InteractiveButton> : null}
            <InteractiveButton variant="toolbar" className="text-danger hover:text-danger" disabled={busy} aria-label={t("connections.removeLabel", { name: device.name })} onClick={() => void act({ type: "revoke", deviceId: device.id })}>{t("connections.remove")}</InteractiveButton>
          </SettingsRow>
        )) : <p className="connections-empty ui-description"><Smartphone size={15} aria-hidden="true" />{t("connections.noDevices")}</p>}
      </SettingsGroup>

      <SettingsGroup title={t("connections.safety")}>
        <p className="ui-description text-text-muted">{t("connections.safetyHelp")}</p>
      </SettingsGroup>
    </div>
  </SettingsSection>;
}
