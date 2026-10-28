import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, LoaderCircle, Pencil, QrCode, RefreshCw, ShieldCheck, Smartphone } from "@/components/icons";
import { IconSwap } from "@/components/icons/IconSwap";
import { client as activeClient, localClient } from "@/client";

/** Remote access is this Mac's own, whatever computer the window works on (ADR-133). */
const client = localClient ?? activeClient;
import type { RemoteAction, RemoteStatus } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { newlyPaired } from "@/lib/remote-connections";
import { PairDeviceDialog } from "./PairDeviceDialog";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Switch } from "@/primitives/Switch";
import { SettingsGroup, SettingsRow, SettingsSection } from "./SettingsSection";
import { ComputersSettings } from "./ComputersSettings";
import "@/styles/general-settings.css";
import "@/styles/connections.css";

/** Settings → Connections (ADR-080): remote access switch, pairing QR code and paired devices. */
export function ConnectionsSettings({ locale }: { locale: string }) {
  const t = useTranslation();
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [pairOpen, setPairOpen] = useState(false);
  /** The device that paired while "Connect a device" was open. */
  const [joined, setJoined] = useState<RemoteStatus["devices"][number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  /** The device being renamed and the name typed so far. */
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const devices = useRef<RemoteStatus["devices"]>([]);

  const apply = useCallback((next: RemoteStatus) => {
    const joined = newlyPaired(devices.current, next.devices);
    devices.current = next.devices;
    setStatus(next);
    // A device that just used the code is shown in the dialog, to be named.
    if (joined) setJoined(joined);
  }, []);
  const refresh = useCallback(() => client.remoteAction({ type: "status" }).then(apply, (reason: unknown) => setError(formatUnknownError(reason))), [apply]);

  useEffect(() => {
    void refresh();
    // Tailscale may come up while the page is open.
    window.addEventListener("focus", refresh);
    const stop = client.onRemoteChanged(() => { void refresh(); });
    return () => { window.removeEventListener("focus", refresh); void stop.then((unlisten) => unlisten()); };
  }, [refresh]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await work(); } catch (reason) { setError(formatUnknownError(reason)); } finally { setBusy(false); }
  };
  const setEnabled = (enabled: boolean) => run(async () => {
    apply(await client.remoteAction({ type: "setEnabled", enabled }));
    if (!enabled) setPairOpen(false);
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

  return <SettingsSection title={t("connections.title")} description={t("connections.intro")}>
    <div className="general-settings">
      <ComputersSettings />
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
              <IconSwap id={copied ? "copied" : "copy"}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}</IconSwap>{copied ? t("connections.copied") : null}
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
        <SettingsRow title={t("connections.connectRow")} description={t("connections.connectRowHelp")}>
          <InteractiveButton variant="secondary" glow={false} onClick={() => { setJoined(null); setPairOpen(true); }}><QrCode size={14} aria-hidden="true" />{t("connections.connect")}</InteractiveButton>
        </SettingsRow>
        <PairDeviceDialog open={pairOpen} onOpenChange={(open) => { setPairOpen(open); if (!open) setJoined(null); }} url={url} joined={joined} clearJoined={() => setJoined(null)}
          newCode={() => client.remotePair()} rename={async (deviceId, name) => apply(await client.remoteAction({ type: "rename", deviceId, name }))} />
      </SettingsGroup> : null}

      <SettingsGroup title={t("connections.devices")} card>
        {status?.devices.length ? status.devices.map((device) => (
          <SettingsRow key={device.id} title={device.name} description={(device.lastSeen
            ? t("connections.deviceSeen", { date: dates.format(new Date(device.createdAt)), seen: times.format(new Date(device.lastSeen)) })
            : t("connections.deviceAdded", { date: dates.format(new Date(device.createdAt)) })) + (device.push ? ` · ${t("connections.alertsOn")}` : "")}>
            {renaming?.id === device.id ? <form className="connections-rename" onSubmit={(event) => {
              event.preventDefault();
              const name = renaming.name.trim();
              setRenaming(null);
              if (name && name !== device.name) void act({ type: "rename", deviceId: device.id, name });
            }}>
              <input autoFocus value={renaming.name} maxLength={60} aria-label={t("connections.renameLabel", { name: device.name })}
                onChange={(event) => setRenaming({ id: device.id, name: event.target.value })}
                onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setRenaming(null); } }} />
              <InteractiveButton variant="toolbar" type="submit" disabled={busy || !renaming.name.trim()}><Check size={14} aria-hidden="true" />{t("connections.renameSave")}</InteractiveButton>
            </form> : <InteractiveButton variant="toolbar" disabled={busy} aria-label={t("connections.renameLabel", { name: device.name })} onClick={() => setRenaming({ id: device.id, name: device.name })}><Pencil size={14} aria-hidden="true" /></InteractiveButton>}
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
