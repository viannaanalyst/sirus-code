import { RotateCcw } from "@/components/icons/phosphor";
import type { ReactNode } from "react";
import type { AgentInstall, AppSettings } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { chooseDefaultProvider, defaultSettings, GENERAL_SETTING_KEYS, isProviderEnabled, resetGeneralSettings } from "@/lib/settings";
import { PROVIDERS } from "@/lib/provider-registry";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Select } from "@/primitives/Select";
import { Switch } from "@/primitives/Switch";
import { ProviderIcon } from "./ProviderIcon";
import { SettingsGroup, SettingsRow, SettingsSection } from "./SettingsSection";
import "@/styles/general-settings.css";

export function GeneralSettings({ settings, agents, onSave }: {
  settings: AppSettings;
  agents: AgentInstall[];
  onSave: (settings: AppSettings) => void;
}) {
  const t = useTranslation();
  const changed = GENERAL_SETTING_KEYS.some(key => settings[key] !== defaultSettings[key]);
  const booleanRow = (key: "openLastProject" | "confirmCloseRunning" | "steerWhileRunning" | "restorePreviousSessions" | "environmentPanelDefaultOpen" | "showEnvironmentUsage" | "showEnvironmentRepository" | "showEnvironmentEditor" | "showEnvironmentPullRequest" | "showEnvironmentPinned" | "showEnvironmentNotepad" | "showEnvironmentInstructions", title: string, description: string) => (
    <SettingsRow title={t(title)} description={t(description)}>
      <Switch checked={settings[key]} label={t(title)} onChange={value => onSave({ ...settings, [key]: value })} />
    </SettingsRow>
  );
  const row = (title: string, description: string | undefined, control: ReactNode) => (
    <SettingsRow title={t(title)} description={description ? t(description) : undefined}>{control}</SettingsRow>
  );
  return <div className="general-settings"><SettingsSection title={t("General")}
    description={t("Choose defaults for new sessions, navigation and the Environment panel.")}
    headerAction={<InteractiveButton variant="secondary" glow={false} disabled={!changed} onClick={() => onSave(resetGeneralSettings(settings))}>
      <RotateCcw size={14} aria-hidden="true" />{t("Restore defaults")}
    </InteractiveButton>}>
    <SettingsGroup title={t("Core defaults")} card>
      {row("Default provider", "Choose the provider for new sessions. Current sessions keep their provider.",
        <Select className="general-settings-select" label={t("Default provider")} value={settings.defaultAgent}
          onChange={provider => onSave(chooseDefaultProvider(settings, provider))}
          options={PROVIDERS.map(provider => {
            const installed = agents.some(item => item.id === provider.id && item.installed);
            const enabled = isProviderEnabled(settings, provider.id);
            return { value: provider.id, label: provider.name, icon: <ProviderIcon id={provider.id} size={16} />,
              disabled: !installed || !enabled, description: !installed || !enabled ? t(!enabled ? "Disabled" : "Not detected") : undefined };
          })} />)}
      {row("New threads", "Choose the default workspace for new sessions.",
        <Select className="general-settings-select" label={t("New threads")} value={settings.defaultSessionWorkspace} onChange={defaultSessionWorkspace => onSave({ ...settings, defaultSessionWorkspace })} options={[
          { value: "ask", label: t("Ask every time") }, { value: "checkout", label: t("Local") }, { value: "worktree", label: t("New worktree") },
        ]} />)}
      {row("Language", undefined,
        <Select className="general-settings-select" label={t("Language")} value={settings.locale} onChange={locale => onSave({ ...settings, locale })} options={[{ value: "pt-BR", label: "Português (Brasil)" }, { value: "en", label: "English" }]} />)}
    </SettingsGroup>
    <SettingsGroup title={t("Sidebar organization")} card>
      {row("Project order", "Pinned projects stay first. Dragging a folder switches to manual order.",
        <Select className="general-settings-select" label={t("Project order")} value={settings.sidebarProjectSortOrder} onChange={sidebarProjectSortOrder => onSave({ ...settings, sidebarProjectSortOrder })} options={[
          { value: "manual", label: t("Manual") }, { value: "created_at", label: t("Created") },
        ]} />)}
      {row("Thread order", "Orders sessions inside each project. Pinned sessions keep their own area.",
        <Select className="general-settings-select" label={t("Thread order")} value={settings.sidebarThreadSortOrder} onChange={sidebarThreadSortOrder => onSave({ ...settings, sidebarThreadSortOrder })} options={[
          { value: "updated_at", label: t("Recent activity") }, { value: "created_at", label: t("Created") },
        ]} />)}
    </SettingsGroup>
    <SettingsGroup title={t("Startup")} card>
      {booleanRow("openLastProject", "Reopen last project", "Automatically reopen the last active project when Switchyard starts.")}
      {booleanRow("restorePreviousSessions", "Reopen newest session", "Reopen the newest-created session in the last project. Other sessions remain in the sidebar; agents do not start automatically.")}
    </SettingsGroup>
    <SettingsGroup title={t("Application")} card>
      {booleanRow("confirmCloseRunning", "Show confirmation before closing running sessions", "Ask before closing or quitting while agents are running.")}
      {booleanRow("steerWhileRunning", "steer.setting", "steer.settingHelp")}
      <SettingsRow title={t("Check for updates automatically")} comingSoon><Switch checked={false} disabled label={t("Check for updates automatically")} onChange={() => undefined} /></SettingsRow>
    </SettingsGroup>
    <SettingsGroup title={t("Environment panel")} card>
      {booleanRow("environmentPanelDefaultOpen", "Open by default", "Open the chat Environment panel automatically on normal threads. When off, the panel stays closed until you open it. Your last open/close also updates this preference.")}
      {booleanRow("showEnvironmentUsage", "Usage", "Show provider usage in the Environment panel.")}
      {booleanRow("showEnvironmentRepository", "Repository", "Show the repository link in the Environment panel.")}
      {booleanRow("showEnvironmentPullRequest", "Pull request and checks", "Show the branch pull request and GitHub checks in the Environment panel.")}
      {booleanRow("showEnvironmentEditor", "Editor", "Show the editor actions in the Environment panel.")}
    </SettingsGroup>
  </SettingsSection></div>;
}
