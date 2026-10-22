import { RotateCcw } from "@/components/icons/phosphor";
import type { AppSettings } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { AUTO_ARCHIVE_DEFAULT_DAYS, AUTO_ARCHIVE_MAX_DAYS, CHAT_AGENT_KEYS, CHAT_SETTING_KEYS, clampArchiveDays as clampDays, defaultSettings, STREAMING_CHOICES } from "@/lib/settings";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { SegmentedControl } from "@/primitives/SegmentedControl";
import { Switch } from "@/primitives/Switch";
import { BrowserProfilesSettings } from "./BrowserProfilesSettings";
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
    </SettingsGroup>
    {/* Agent behavior and Auto-archive (ADR-130), also on the phone's Mac settings. */}
    <SettingsGroup title={t("settings.agentBehavior")} card>
      <SettingsRow title={t("settings.responseStreaming")} description={t("settings.responseStreamingHelp")}>
        <SegmentedControl label={t("settings.responseStreaming")} value={settings.responseStreaming} options={STREAMING_CHOICES.map((choice) => ({ value: choice.mode, label: t(choice.label) }))}
          onChange={(responseStreaming) => onSave({ ...settings, responseStreaming })} />
      </SettingsRow>
      <SettingsRow title={t("settings.browserAccess")} description={t("settings.browserAccessHelp")}>
        <Switch checked={settings.agentBrowserAccess} label={t("settings.browserAccess")} onChange={(agentBrowserAccess) => onSave({ ...settings, agentBrowserAccess })} />
      </SettingsRow>
    </SettingsGroup>
    <SettingsGroup title={t("settings.autoArchive")} card>
      <SettingsRow title={t("settings.autoArchiveMerged")} description={t("settings.autoArchiveMergedHelp")}>
        <Switch checked={settings.autoArchiveMerged} label={t("settings.autoArchiveMerged")} onChange={(autoArchiveMerged) => onSave({ ...settings, autoArchiveMerged })} />
      </SettingsRow>
      <SettingsRow title={t("settings.autoArchiveInactive", { days: settings.autoArchiveInactiveDays ?? AUTO_ARCHIVE_DEFAULT_DAYS })} description={t("settings.autoArchiveInactiveHelp")}>
        <Switch checked={settings.autoArchiveInactiveDays !== null} label={t("settings.autoArchiveInactive", { days: settings.autoArchiveInactiveDays ?? AUTO_ARCHIVE_DEFAULT_DAYS })}
          onChange={(on) => onSave({ ...settings, autoArchiveInactiveDays: on ? AUTO_ARCHIVE_DEFAULT_DAYS : null })} />
      </SettingsRow>
      {settings.autoArchiveInactiveDays !== null ? <SettingsRow title={t("settings.inactiveDays")} description={t("settings.inactiveDaysHelp")}>
        <input type="number" min={1} max={AUTO_ARCHIVE_MAX_DAYS} step={1} aria-label={t("settings.inactiveDays")} defaultValue={settings.autoArchiveInactiveDays} key={settings.autoArchiveInactiveDays}
          onBlur={(event) => { const days = clampDays(event.target.valueAsNumber); event.target.value = String(days); if (days !== settings.autoArchiveInactiveDays) onSave({ ...settings, autoArchiveInactiveDays: days }); }}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          className="h-8 w-[80px] rounded-[var(--radius-md)] border border-border-subtle bg-background-1 px-2.5 text-right font-mono ui-control outline-none focus:border-border-default" />
      </SettingsRow> : null}
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
      {toggle("confirmArchive", "chatBehavior.confirmArchive", "chatBehavior.confirmArchiveHelp")}
      {toggle("confirmTerminalClose", "chatBehavior.confirmTerminal", "chatBehavior.confirmTerminalHelp")}
      <SettingsRow title={t("chatBehavior.confirmDelete")} description={t("chatBehavior.confirmDeleteHelp")}>
        <Switch checked disabled label={t("chatBehavior.confirmDelete")} onChange={() => undefined} />
      </SettingsRow>
    </SettingsGroup>
  </SettingsSection></div>;
}
