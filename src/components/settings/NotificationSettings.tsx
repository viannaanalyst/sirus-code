import { useEffect, useState } from "react";
import { Play, RotateCcw } from "@/components/icons/phosphor";
import { client } from "@/client";
import type { AppSettings, NotificationAction, NotificationPermission } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { defaultNotifications, NOTIFICATION_SOUNDS, resetNotificationSettings } from "@/lib/notifications";
import { formatUnknownError } from "@/lib/format-error";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { IconButton } from "@/primitives/IconButton";
import { Select } from "@/primitives/Select";
import { Switch } from "@/primitives/Switch";
import { SettingsGroup, SettingsRow, SettingsSection } from "./SettingsSection";
import "@/styles/general-settings.css";

export function NotificationSettings({ settings, onSave }: { settings: AppSettings; onSave: (next: AppSettings) => void }) {
  const t = useTranslation();
  const prefs = settings.notifications;
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => { void client.notificationAction({ type: "status" }).then(value => { if (alive) setPermission(value); }).catch(error => { if (alive) setFailure(formatUnknownError(error)); }); };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { alive = false; window.removeEventListener("focus", refresh); };
  }, []);
  const save = (patch: Partial<AppSettings["notifications"]>) => onSave({ ...settings, notifications: { ...prefs, ...patch } });
  async function act(action: NotificationAction) {
    if (busy) return;
    setBusy(true); setFailure(null); setFeedback(null);
    try {
      const next = await client.notificationAction(action);
      setPermission(next);
      if (action.type === "test") setFeedback("Test notification sent. The system controls whether a banner is visible.");
      if (action.type === "request" && next === "denied") setFeedback("Allow notifications in System Settings to receive system alerts.");
    } catch (error) { setFailure(formatUnknownError(error)); }
    finally { setBusy(false); }
  }
  const unavailable = permission === "unsupported";
  const status = permission === "granted" ? "System notifications allowed" : permission === "denied" ? "Notifications blocked in System Settings" : permission === "prompt" ? "Notification permission required" : unavailable ? "System notifications and sounds are unavailable on this host." : "Checking notification permission…";
  const toggle = (key: "toasts" | "system" | "sounds" | "foreground", label: string) => <Switch label={t(label)} checked={prefs[key]} disabled={key !== "toasts" && unavailable} onChange={value => save({ [key]: value })} />;
  const rows = [
    { key: "permissions", sound: "permissionSound", label: "Permission requests", description: "When an agent needs approval to continue." },
    { key: "questions", sound: "questionSound", label: "Questions from the agent", description: "When an agent asks you to choose or answer." },
    { key: "completion", sound: "completionSound", label: "Task completed", description: "When a turn finishes successfully. Cancelled and failed turns do not notify." },
  ] as const;
  return <div className="general-settings"><SettingsSection title={t("Notifications")} description={t("Choose how Switchyard alerts you when work finishes or needs your attention.")}
    headerAction={<InteractiveButton variant="secondary" glow={false} disabled={Object.entries(defaultNotifications).every(([key, value]) => prefs[key as keyof typeof prefs] === value)} onClick={() => onSave(resetNotificationSettings(settings))}><RotateCcw size={14} aria-hidden="true" />{t("Restore defaults")}</InteractiveButton>}>
    <SettingsGroup title={t("Activity alerts")} card>
      <SettingsRow title={t("Activity toasts")} description={t("Show an in-app alert for sessions you are not currently viewing.")}>{toggle("toasts", "Activity toasts")}</SettingsRow>
      <SettingsRow title={t("System notifications")} description={t(status)}>
        {permission === "prompt" && <InteractiveButton variant="secondary" glow={false} disabled={busy} onClick={() => void act({ type: "request" })}>{t("Allow")}</InteractiveButton>}
        {permission === "denied" && <InteractiveButton variant="secondary" glow={false} disabled={busy} onClick={() => void act({ type: "settings" })}>{t("System Settings")}</InteractiveButton>}
        <InteractiveButton variant="secondary" glow={false} disabled={busy || permission !== "granted"} onClick={() => void act({ type: "test" })}>{t("Test")}</InteractiveButton>
        {toggle("system", "System notifications")}
      </SettingsRow>
      <SettingsRow title={t("Notification sounds")} description={t("Play the selected cue. Uses your system output volume.")}>{toggle("sounds", "Notification sounds")}</SettingsRow>
      <SettingsRow title={t("Notify while app is in focus")} description={t("Also show system alerts and play sounds while Switchyard is active.")}>{toggle("foreground", "Notify while app is in focus")}</SettingsRow>
    </SettingsGroup>
    <SettingsGroup title={t("Events and sounds")} card>
      {rows.map(row => <SettingsRow key={row.key} title={t(row.label)} description={t(row.description)}>
        <Select className="general-settings-select" label={t(row.label) + " · " + t("Sound")} value={prefs[row.sound]} disabled={unavailable} onChange={sound => save({ [row.sound]: sound })} options={NOTIFICATION_SOUNDS.map(sound => ({ value: sound, label: sound[0].toUpperCase() + sound.slice(1) }))} />
        <IconButton tooltip={false} label={t("Preview sound") + " · " + t(row.label)} disabled={busy || unavailable} onClick={() => void act({ type: "preview", sound: prefs[row.sound] })}><Play size={14} aria-hidden="true" /></IconButton>
        <Switch label={t(row.label)} checked={prefs[row.key]} onChange={value => save({ [row.key]: value })} />
      </SettingsRow>)}
    </SettingsGroup>
    {feedback && <p role="status" className="mt-4 ui-caption text-text-secondary">{t(feedback)}</p>}
    {failure && <p role="alert" className="mt-4 ui-caption text-danger">{t(failure)}</p>}
  </SettingsSection></div>;
}
