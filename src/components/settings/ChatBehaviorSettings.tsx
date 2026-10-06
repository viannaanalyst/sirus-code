import { RotateCcw } from "@/components/icons/phosphor";
import type { AppSettings } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { CHAT_SETTING_KEYS, defaultSettings } from "@/lib/settings";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { SegmentedControl } from "@/primitives/SegmentedControl";
import { Switch } from "@/primitives/Switch";
import { SettingsGroup, SettingsRow, SettingsSection } from "./SettingsSection";
import "@/styles/general-settings.css";

type ChatKey = (typeof CHAT_SETTING_KEYS)[number];

/** Chat behavior: live replies, follow-ups, dictation, review defaults and safety confirmations. */
export function ChatBehaviorSettings({ settings, onSave }: { settings: AppSettings; onSave: (settings: AppSettings) => void }) {
  const t = useTranslation();
  const changed = CHAT_SETTING_KEYS.some((key) => settings[key] !== defaultSettings[key]);
  const toggle = (key: ChatKey, title: string, description: string) => (
    <SettingsRow title={t(title)} description={t(description)}>
      <Switch checked={settings[key]} label={t(title)} onChange={(value) => onSave({ ...settings, [key]: value })} />
    </SettingsRow>
  );
  const choice = <T extends string>(key: ChatKey, title: string, description: string, options: { value: T; label: string }[], value: T, toSetting: (value: T) => boolean) => (
    <SettingsRow title={t(title)} description={t(description)}>
      <SegmentedControl label={t(title)} value={value} options={options.map((option) => ({ value: option.value, label: t(option.label) }))}
        onChange={(next) => onSave({ ...settings, [key]: toSetting(next as T) })} />
    </SettingsRow>
  );
  return <div className="general-settings"><SettingsSection title={t("chatBehavior.title")} description={t("chatBehavior.description")}
    headerAction={<InteractiveButton variant="secondary" glow={false} disabled={!changed} onClick={() => {
      const restored = { ...settings };
      for (const key of CHAT_SETTING_KEYS) Object.assign(restored, { [key]: defaultSettings[key] });
      onSave(restored);
    }}><RotateCcw size={14} aria-hidden="true" />{t("Restore defaults")}</InteractiveButton>}>
    <SettingsGroup title={t("chatBehavior.conversation")} card>
      {choice("steerWhileRunning", "chatBehavior.followUp", "chatBehavior.followUpHelp",
        [{ value: "queue", label: "chatBehavior.queue" }, { value: "steer", label: "chatBehavior.steer" }],
        settings.steerWhileRunning ? "steer" : "queue", (value) => value === "steer")}
      {choice("dictationEnterSends", "chatBehavior.dictationEnter", "chatBehavior.dictationEnterHelp",
        [{ value: "stop", label: "chatBehavior.stop" }, { value: "send", label: "chatBehavior.stopSend" }],
        settings.dictationEnterSends ? "send" : "stop", (value) => value === "send")}
      {toggle("foldFinishedTurns", "chatBehavior.fold", "chatBehavior.foldHelp")}
      {toggle("autoOpenSimulator", "chatBehavior.simulator", "chatBehavior.simulatorHelp")}
    </SettingsGroup>
    <SettingsGroup title={t("chatBehavior.review")} card>
      {choice("githubLinksInApp", "chatBehavior.links", "chatBehavior.linksHelp",
        [{ value: "app", label: "chatBehavior.inApp" }, { value: "external", label: "chatBehavior.external" }],
        settings.githubLinksInApp ? "app" : "external", (value) => value === "app")}
      {toggle("diffWordWrap", "chatBehavior.wrap", "chatBehavior.wrapHelp")}
    </SettingsGroup>
    <SettingsGroup title={t("chatBehavior.safety")} card>
      {toggle("confirmArchive", "chatBehavior.confirmArchive", "chatBehavior.confirmArchiveHelp")}
      {toggle("confirmTerminalClose", "chatBehavior.confirmTerminal", "chatBehavior.confirmTerminalHelp")}
      <SettingsRow title={t("chatBehavior.confirmDelete")} description={t("chatBehavior.confirmDeleteHelp")}>
        <Switch checked disabled label={t("chatBehavior.confirmDelete")} onChange={() => undefined} />
      </SettingsRow>
    </SettingsGroup>
  </SettingsSection></div>;
}
