import { RotateCcw } from "@/components/icons";
import type { AppSettings } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { CHAT_AGENT_KEYS, CHAT_SETTING_KEYS, defaultSettings, STREAMING_CHOICES } from "@/lib/settings";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { SegmentedControl } from "@/primitives/SegmentedControl";
import { Switch } from "@/primitives/Switch";
import { BrowserProfilesSettings } from "./BrowserProfilesSettings";
import { SavedLoginsSettings } from "./SavedLoginsSettings";
import { SettingsGroup, SettingsRow, SettingsSection } from "./SettingsSection";
import "@/styles/general-settings.css";

type ChatKey = Exclude<(typeof CHAT_SETTING_KEYS)[number], "linkOpenTarget">;

/** Chat behavior: live replies, follow-ups, dictation, review defaults and safety confirmations. */
export function ChatBehaviorSettings({ settings, onSave }: { settings: AppSettings; onSave: (settings: AppSettings) => void }) {
  const t = useTranslation();
  const changed = [...CHAT_SETTING_KEYS, ...CHAT_AGENT_KEYS].some((key) => settings[key] !== defaultSettings[key]);
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
      for (const key of [...CHAT_SETTING_KEYS, ...CHAT_AGENT_KEYS]) Object.assign(restored, { [key]: defaultSettings[key] });
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
      {toggle("showWorkingPanel", "chatBehavior.workingPanel", "chatBehavior.workingPanelHelp")}
      {toggle("composerAutocorrect", "chatBehavior.autocorrect", "chatBehavior.autocorrectHelp")}
      {toggle("showSessionTabs", "chatBehavior.sessionTabs", "chatBehavior.sessionTabsHelp")}
      {toggle("continueInterruptedSessions", "chatBehavior.continueInterrupted", "chatBehavior.continueInterruptedHelp")}
      {toggle("compactIdleBeforeCacheExpiry", "chatBehavior.compactIdle", "chatBehavior.compactIdleHelp")}
      {toggle("rotateAtContextLimit", "chatBehavior.rotate", "chatBehavior.rotateHelp")}
    </SettingsGroup>
    {/* Agent behavior (ADR-130), also on the phone's Mac settings. */}
    <SettingsGroup title={t("settings.agentBehavior")} card>
      <SettingsRow title={t("settings.responseStreaming")} description={t("settings.responseStreamingHelp")}>
        <SegmentedControl label={t("settings.responseStreaming")} value={settings.responseStreaming} options={STREAMING_CHOICES.map((choice) => ({ value: choice.mode, label: t(choice.label) }))}
          onChange={(responseStreaming) => onSave({ ...settings, responseStreaming })} />
      </SettingsRow>
      <SettingsRow title={t("settings.browserAccess")} description={t("settings.browserAccessHelp")}>
        <Switch checked={settings.agentBrowserAccess} label={t("settings.browserAccess")} onChange={(agentBrowserAccess) => onSave({ ...settings, agentBrowserAccess })} />
      </SettingsRow>
    </SettingsGroup>
    <SettingsGroup title={t("chatBehavior.review")} card>
      {/* How links open (ADR-149): ⌘, Ctrl, Alt or middle click always use the system browser. */}
      <SettingsRow title={t("chatBehavior.openLinksIn")} description={t("chatBehavior.openLinksInHelp")}>
        <SegmentedControl label={t("chatBehavior.openLinksIn")} value={settings.linkOpenTarget}
          options={[{ value: "app", label: t("chatBehavior.sirusBrowser") }, { value: "system", label: t("chatBehavior.systemBrowser") }]}
          onChange={(next) => onSave({ ...settings, linkOpenTarget: next === "system" ? "system" : "app" })} />
      </SettingsRow>
      {choice("githubLinksInApp", "chatBehavior.links", "chatBehavior.linksHelp",
        [{ value: "app", label: "chatBehavior.inApp" }, { value: "external", label: "chatBehavior.external" }],
        settings.githubLinksInApp ? "app" : "external", (value) => value === "app")}
      {toggle("diffWordWrap", "chatBehavior.wrap", "chatBehavior.wrapHelp")}
    </SettingsGroup>
    {/* Pages an agent opens float over the conversation (ADR-151). */}
    <SettingsGroup title={t("browser.settingsGroup")} card>
      <SettingsRow title={t("browser.showAgentPages")} description={t("browser.showAgentPagesHelp")}>
        <Switch checked={settings.browserShowAgentPages} label={t("browser.showAgentPages")} onChange={(value) => onSave({ ...settings, browserShowAgentPages: value })} />
      </SettingsRow>
    </SettingsGroup>
    {/* Browser profiles (ADR-149). */}
    <BrowserProfilesSettings settings={settings} onSave={onSave} />
    {/* Saved logins in the Keychain (ADR-186). */}
    <SavedLoginsSettings />
    {/* Browser recordings (ADR-112). */}
    <SettingsGroup title={t("browser.recordingSettings")} card>
      <SettingsRow title={t("browser.recordFps")} description={t("browser.recordFpsHelp")}>
        <SegmentedControl label={t("browser.recordFps")} value={String(settings.browserRecordingFps)} options={[{ value: "30", label: "30 fps" }, { value: "60", label: "60 fps" }]}
          onChange={(value) => onSave({ ...settings, browserRecordingFps: Number(value) })} />
      </SettingsRow>
      <SettingsRow title={t("browser.recordKeys")} description={t("browser.recordKeysHelp")}>
        <Switch checked={settings.browserRecordingKeys} label={t("browser.recordKeys")} onChange={(value) => onSave({ ...settings, browserRecordingKeys: value })} />
      </SettingsRow>
      <SettingsRow title={t("browser.recordClicks")} description={t("browser.recordClicksHelp")}>
        <Switch checked={settings.browserRecordingClicks} label={t("browser.recordClicks")} onChange={(value) => onSave({ ...settings, browserRecordingClicks: value })} />
      </SettingsRow>
    </SettingsGroup>
    <SettingsGroup title={t("chatBehavior.safety")} card>
      {toggle("confirmTerminalClose", "chatBehavior.confirmTerminal", "chatBehavior.confirmTerminalHelp")}
      <SettingsRow title={t("chatBehavior.confirmDelete")} description={t("chatBehavior.confirmDeleteHelp")}>
        <Switch checked disabled label={t("chatBehavior.confirmDelete")} onChange={() => undefined} />
      </SettingsRow>
    </SettingsGroup>
  </SettingsSection></div>;
}
