import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { client } from "@/client";
import type { DeviceHubAccess, DeviceStatus, SimDevice } from "@/client/types";
import { ChevronDown, DeviceRotate, HomeButton, Link, Lock, Moon, PowerIcon, Sun } from "@/components/icons";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/primitives/Dropdown";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { useAppStore } from "@/store/app-store";
import { DeviceScreen, type DeviceScreenHandle } from "./DeviceScreen";
import "@/styles/devices.css";

const LEASE_MS = 20_000;
const SAVED_DEVICE = "sirus.devices.udid";

function useDocumentVisible() {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

function savedDevice(): string | null {
  try { return localStorage.getItem(SAVED_DEVICE); } catch { return null; }
}

function saveDevice(udid: string | null) {
  try {
    if (udid) localStorage.setItem(SAVED_DEVICE, udid);
    else localStorage.removeItem(SAVED_DEVICE);
  } catch { /* private mode */ }
}

/**
 * Devices pane (ADR-128): Xcode and Node.js checks, the consented install of
 * Expo's device hub, then a picker and a live, touchable simulator. The pane
 * holds a hub lease only while it is shown and the window is visible.
 */
export function DevicesPane({ paneId }: { paneId: string }) {
  const t = useTranslation();
  const visible = useDocumentVisible();
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [access, setAccess] = useState<DeviceHubAccess | null>(null);
  const [attached, setAttached] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ kind: "booting" | "installing"; name?: string } | null>(null);
  const [input, setInput] = useState(false);
  const [confirmShutdown, setConfirmShutdown] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState("");
  const screen = useRef<DeviceScreenHandle>(null);
  const lease = useRef(`pane-${paneId}`);
  const autoAttached = useRef(false);
  const fail = useCallback((reason: unknown) => useAppStore.setState({ error: formatUnknownError(reason) }), []);

  const refresh = useCallback(async () => {
    try { setStatus(await client.deviceStatus()); } catch (reason) { fail(reason); }
  }, [fail]);

  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Install, hub and boot changes arrive as one event; several in a row refresh once.
    const stop = client.onDeviceChanged(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 150);
    });
    return () => {
      if (timer) clearTimeout(timer);
      void stop.then((unlisten) => unlisten());
    };
  }, [refresh]);

  // The hub runs while a visible pane renews its lease.
  const installed = status?.tools.installed ?? false;
  useEffect(() => {
    if (!installed || !visible) return;
    const id = lease.current;
    let alive = true;
    const renew = () => client.deviceAction<DeviceStatus["proxy"]>({ type: "lease", id })
      .then((proxy) => { if (alive) setAccess((current) => {
        const next = client.deviceHubAccess(proxy);
        return current && next && current.httpBase === next.httpBase && current.token === next.token ? current : next;
      }); })
      .catch((reason) => { if (alive) fail(reason); });
    void renew();
    const timer = setInterval(() => void renew(), LEASE_MS);
    return () => {
      alive = false;
      clearInterval(timer);
      void client.deviceAction({ type: "release", id }).catch(() => undefined);
    };
  }, [installed, visible, fail]);

  const devices = useMemo(() => status?.devices ?? [], [status]);
  const current = devices.find((device) => device.udid === attached) ?? null;
  const hubRunning = status?.hub.running ?? false;

  const attach = useCallback(async (device: SimDevice, quiet = false) => {
    setBusy({ kind: "booting", name: device.name });
    try {
      await client.deviceAction({ type: "attach", udid: device.udid });
      setAttached(device.udid);
      saveDevice(device.udid);
    } catch (reason) {
      if (!quiet) fail(reason);
    } finally {
      setBusy(null);
      void refresh();
    }
  }, [fail, refresh]);

  // Reopening the pane brings back the last simulator if it is still booted.
  useEffect(() => {
    if (autoAttached.current || !hubRunning || attached) return;
    const saved = savedDevice();
    const device = devices.find((item) => item.udid === saved && item.booted);
    if (!device) return;
    autoAttached.current = true;
    void attach(device, true);
  }, [hubRunning, attached, devices, attach]);

  // A simulator shut down elsewhere ends the stream here.
  useEffect(() => {
    if (attached && status && !status.devices.some((device) => device.udid === attached && device.booted) && !busy) setAttached(null);
  }, [attached, status, busy]);

  const install = async () => {
    setBusy({ kind: "installing" });
    try { await client.deviceAction({ type: "install", consent: true }); }
    catch (reason) { fail(reason); }
    finally { setBusy(null); void refresh(); }
  };

  const act = (action: Parameters<typeof client.deviceAction>[0]) => void client.deviceAction(action).catch(fail);

  const openUrl = (event: FormEvent) => {
    event.preventDefault();
    if (!attached || !url.trim()) return;
    act({ type: "openUrl", udid: attached, url: url.trim() });
    setUrlOpen(false);
  };

  if (!status) return <p role="status" className="device-note ui-control">{t("devices.checking")}</p>;

  if (!status.xcode || !status.nodeOk) {
    const xcode = !status.xcode;
    return (
      <div className="device-setup">
        <div className="device-card">
          <h3 className="ui-control font-medium text-text-primary">{t(xcode ? "devices.needsMacTitle" : "devices.needsNodeTitle")}</h3>
          <p className="ui-caption text-text-secondary">{t(xcode ? "devices.needsMac" : "devices.needsNode")}</p>
          {!xcode && status.nodeVersion ? <p className="ui-caption text-text-muted">{t("devices.nodeFound", { version: status.nodeVersion })}</p> : null}
          <InteractiveButton variant="secondary" glow={false} onClick={() => void refresh()}>{t("devices.checkAgain")}</InteractiveButton>
        </div>
      </div>
    );
  }

  if (!status.tools.installed) {
    const installing = status.tools.installing || busy?.kind === "installing";
    return (
      <div className="device-setup">
        <div className="device-card">
          <h3 className="ui-control font-medium text-text-primary">{t("devices.installTitle")}</h3>
          <p className="ui-caption text-text-secondary">{t("devices.installBody", { package: status.tools.hubPackage, version: status.tools.hubVersion })}</p>
          {status.tools.error ? <p role="alert" className="ui-caption text-[var(--danger)]">{t("devices.installFailed", { error: status.tools.error })}</p> : null}
          <InteractiveButton variant="primary" loading={installing} disabled={installing} onClick={() => void install()}>
            {t(installing ? "devices.installing" : "devices.install")}
          </InteractiveButton>
        </div>
      </div>
    );
  }

  const hubNote = status.hub.starting || (!hubRunning && !status.hub.error) ? t("devices.hubStarting")
    : !hubRunning && status.hub.error ? t("devices.hubFailed", { error: status.hub.error }) : null;
  const ready = !!current && !!access && hubRunning && !busy;

  return (
    <div className="device-pane">
      <div className="device-toolbar" role="toolbar" aria-label={t("devices.controls")}>
        <Dropdown>
          <DropdownTrigger asChild>
            <button type="button" className="device-picker ui-control" disabled={!devices.length || !!busy || !hubRunning}>
              <span className="truncate">{current?.name ?? t("devices.choose")}</span>
              <ChevronDown size={13} aria-hidden="true" />
            </button>
          </DropdownTrigger>
          <DropdownContent align="start" side="bottom" className="device-menu">
            {devices.map((device) => (
              <DropdownItem key={device.udid} onSelect={() => void attach(device)}>
                <span className="device-menu-row">
                  <span className="truncate">{device.name}</span>
                  <span className="text-text-muted">{device.runtime} · {t(device.booted ? "devices.booted" : "devices.off")}</span>
                </span>
              </DropdownItem>
            ))}
          </DropdownContent>
        </Dropdown>
        <span className="flex-1" />
        <button type="button" className="device-tool" title={t("devices.home")} aria-label={t("devices.home")} disabled={!ready || !input} onClick={() => screen.current?.pressButton("home")}><HomeButton size={15} /></button>
        <button type="button" className="device-tool" title={t("devices.lock")} aria-label={t("devices.lock")} disabled={!ready || !input} onClick={() => screen.current?.pressButton("lock")}><Lock size={15} /></button>
        <button type="button" className="device-tool" title={t("devices.rotate")} aria-label={t("devices.rotate")} disabled={!ready || !input} onClick={() => screen.current?.rotate()}><DeviceRotate size={15} /></button>
        <Dropdown>
          <DropdownTrigger asChild>
            <button type="button" className="device-tool" title={t("devices.appearance")} aria-label={t("devices.appearance")} disabled={!ready}><Sun size={15} /></button>
          </DropdownTrigger>
          <DropdownContent align="end" side="bottom">
            <DropdownItem icon={<Sun size={15} />} onSelect={() => attached && act({ type: "appearance", udid: attached, dark: false })}>{t("devices.light")}</DropdownItem>
            <DropdownItem icon={<Moon size={15} />} onSelect={() => attached && act({ type: "appearance", udid: attached, dark: true })}>{t("devices.dark")}</DropdownItem>
          </DropdownContent>
        </Dropdown>
        <Popover open={urlOpen} onOpenChange={setUrlOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="device-tool" title={t("devices.openUrl")} aria-label={t("devices.openUrl")} disabled={!ready}><Link size={15} /></button>
          </PopoverTrigger>
          <PopoverContent align="end" side="bottom" className="device-url">
            <form onSubmit={openUrl} className="flex items-center gap-1.5">
              <input autoFocus value={url} onChange={(event) => setUrl(event.target.value)} placeholder={t("devices.openUrlPlaceholder")} aria-label={t("devices.openUrl")} spellCheck={false} autoCapitalize="off" className="device-url-input ui-control" />
              <InteractiveButton type="submit" variant="secondary" glow={false} disabled={!url.trim()}>{t("devices.open")}</InteractiveButton>
            </form>
          </PopoverContent>
        </Popover>
        <button type="button" className="device-tool" title={t("devices.shutdown")} aria-label={t("devices.shutdown")} disabled={!ready} onClick={() => setConfirmShutdown(true)}><PowerIcon size={15} /></button>
      </div>
      <div className="device-body">
        {busy?.kind === "booting" ? <p role="status" className="device-note ui-control">{t("devices.booting", { name: busy.name ?? "" })}</p>
          : hubNote ? <p role="status" className="device-note ui-control">{hubNote}</p>
          : ready && current && access ? <DeviceScreen ref={screen} udid={current.udid} name={current.name} access={access} visible={visible} onInput={setInput} />
          : !devices.length ? <p className="device-note ui-control">{t("devices.none")}</p>
          : (
            <div className="device-list">
              <p className="ui-caption text-text-muted">{t("devices.chooseHint")}</p>
              {devices.slice(0, 12).map((device) => (
                <button key={device.udid} type="button" className="device-row ui-control" onClick={() => void attach(device)}>
                  <span className="truncate text-text-primary">{device.name}</span>
                  <span className="text-text-muted">{device.runtime} · {t(device.booted ? "devices.booted" : "devices.off")}</span>
                </button>
              ))}
            </div>
          )}
      </div>
      <ConfirmDialog
        open={confirmShutdown}
        onOpenChange={setConfirmShutdown}
        title={t("devices.shutdownTitle")}
        description={t("devices.shutdownBody")}
        confirmLabel={t("devices.shutdown")}
        cancelLabel={t("common.cancel")}
        onConfirm={async () => {
          if (!attached) return;
          try {
            await client.deviceAction({ type: "shutdown", udid: attached, confirm: true });
            setAttached(null);
            saveDevice(null);
          } catch (reason) { fail(reason); }
          finally { void refresh(); }
        }}
      />
    </div>
  );
}
