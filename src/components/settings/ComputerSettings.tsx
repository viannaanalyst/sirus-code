import { useEffect } from "react";
import { Hand, OctagonX, ShieldCheck, Telescope } from "@/components/icons/phosphor";
import type { AppSettings, WindowSnapShortcut } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Select } from "@/primitives/Select";
import { Switch } from "@/primitives/Switch";
import { useAppStore } from "@/store/app-store";
import { SettingsGroup, SettingsRow, SettingsSection } from "./SettingsSection";
import "@/styles/general-settings.css";
import "@/styles/computer.css";

function Permission({ title, help, granted, onAllow, onOpen }: { title: string; help: string; granted: boolean; onAllow: () => void; onOpen: () => void }) {
  const t = useTranslation();
  return <SettingsRow title={title} description={help}>
    {granted
      ? <span className="computer-status" data-granted>{t("computer.granted")}</span>
      : <div className="flex gap-2"><InteractiveButton variant="secondary" glow={false} onClick={onAllow}>{t("computer.allow")}</InteractiveButton><InteractiveButton variant="toolbar" onClick={onOpen}>{t("computer.openSettings")}</InteractiveButton></div>}
  </SettingsRow>;
}

export function ComputerSettings({ settings, onSave }: { settings: AppSettings; onSave: (next: AppSettings) => void }) {
  const t = useTranslation();
  const computer = useAppStore(state => state.computer);
  const act = useAppStore(state => state.computerAction);
  const sessions = useAppStore(state => state.sessions);
  // Re-read permissions when returning from System Settings.
  useEffect(() => {
    const refresh = () => { void act({ type: "status" }); };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [act]);
  const sessionTitle = (id: string) => sessions.find(session => session.id === id)?.title ?? "";
  const time = new Intl.DateTimeFormat(settings.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  if (computer && !computer.supported) return <SettingsSection title={t("computer.title")} description={t("computer.unsupported")}><span /></SettingsSection>;

  return <SettingsSection title={t("computer.title")} description={t("computer.intro")}>
    <div className="general-settings">
      <SettingsGroup title={t("windowSnap.title")} card>
        <SettingsRow title={t("windowSnap.enable")} description={t("windowSnap.enableHelp")}>
          <Switch checked={settings.windowSnapEnabled} onChange={value => onSave({ ...settings, windowSnapEnabled: value })} label={t("windowSnap.enable")} />
        </SettingsRow>
        <SettingsRow title={t("windowSnap.shortcut")} description={t("windowSnap.shortcutHelp")}>
          <Select className="general-settings-select" label={t("windowSnap.shortcut")} disabled={!settings.windowSnapEnabled} value={settings.windowSnapShortcut}
            onChange={value => onSave({ ...settings, windowSnapShortcut: value as WindowSnapShortcut })}
            options={[{ value: "controlOptionCommandS", label: "⌃⌥⌘S" }, { value: "optionShiftS", label: "⌥⇧S" }, { value: "controlShiftS", label: "⌃⇧S" }]} />
        </SettingsRow>
        {settings.windowSnapEnabled && !computer?.screenRecording ? <Permission title={t("computer.screenRecording")} help={t("windowSnap.permissionHelp")} granted={false}
          onAllow={() => void act({ type: "requestScreenRecording" })} onOpen={() => void act({ type: "openScreenRecordingSettings" })} /> : null}
      </SettingsGroup>

      <SettingsGroup title={t("computer.title")} card>
        <SettingsRow title={t("computer.enable")} description={t("computer.enableHelp")}>
          <Switch checked={settings.computerUseEnabled} onChange={value => onSave({ ...settings, computerUseEnabled: value })} label={t("computer.enable")} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("computer.permissions")} card>
        <Permission title={t("computer.accessibility")} help={t("computer.accessibilityHelp")} granted={!!computer?.accessibility}
          onAllow={() => void act({ type: "requestAccessibility" })} onOpen={() => void act({ type: "openAccessibilitySettings" })} />
        <Permission title={t("computer.screenRecording")} help={t("computer.screenRecordingHelp")} granted={!!computer?.screenRecording}
          onAllow={() => void act({ type: "requestScreenRecording" })} onOpen={() => void act({ type: "openScreenRecordingSettings" })} />
      </SettingsGroup>
      {computer && (!computer.accessibility || !computer.screenRecording) && <p className="-mt-6 mb-8 ui-caption text-text-muted">{t("computer.restartHint")}</p>}

      <SettingsGroup title={t("computer.safety")} card>
        {([[ShieldCheck, "computer.safetyApproval"], [OctagonX, "computer.safetyStop"], [Telescope, "computer.safetyPlanning"]] as const).map(([Icon, key]) => (
          <div key={key} className="computer-fact settings-row">
            <Icon size={16} aria-hidden="true" />
            <div><p className="ui-control font-medium text-text-primary">{t(key)}</p><p className="mt-0.5 ui-description text-text-muted">{t(`${key}Help`)}</p></div>
          </div>
        ))}
      </SettingsGroup>

      <SettingsGroup title={t("computer.grants")} card>
        {computer?.grants.length ? computer.grants.map(grant => (
          <SettingsRow key={`${grant.sessionId}:${grant.bundleId}`} title={grant.app} description={sessionTitle(grant.sessionId)}>
            <InteractiveButton variant="toolbar" onClick={() => void act({ type: "revoke", sessionId: grant.sessionId, bundleId: grant.bundleId })}>{t("computer.revoke")}</InteractiveButton>
          </SettingsRow>
        )) : <p className="computer-empty ui-description">{t("computer.noGrants")}</p>}
      </SettingsGroup>
      {!!computer?.grants.length && <div className="-mt-5 mb-8 flex justify-end"><InteractiveButton variant="secondary" glow={false} onClick={() => void act({ type: "stop" })}><Hand size={14} aria-hidden="true" />{t("computer.stopAll")}</InteractiveButton></div>}

      <SettingsGroup title={t("computer.blocked")}>
        <p className="mb-2 ui-description text-text-muted">{t("computer.blockedHelp")}</p>
        <div className="flex flex-wrap gap-1.5">{computer?.blocked.map(name => <span key={name} className="computer-chip ui-caption">{name}</span>)}</div>
      </SettingsGroup>

      <SettingsGroup title={t("computer.history")} card>
        {computer?.history.filter(entry => entry.app).length ? computer.history.filter(entry => entry.app).slice(0, 30).map((entry, index) => (
          <div key={`${entry.at}:${index}`} className="computer-history settings-row">
            <span className="ui-caption tabular-nums text-text-muted">{time.format(new Date(entry.at))}</span>
            <span className="min-w-0 flex-1 truncate ui-control text-text-primary">{entry.app} <span className="text-text-muted">· {entry.action}</span></span>
            <span className="computer-outcome ui-caption" data-outcome={entry.outcome}>{t(`computer.outcome.${entry.outcome}`)}</span>
          </div>
        )) : <p className="computer-empty ui-description">{t("computer.noHistory")}</p>}
      </SettingsGroup>
    </div>
  </SettingsSection>;
}
