import { Download, GitFork, Globe, RefreshCw, RotateCcw } from "@/components/icons";
import type { AppSettings } from "@/client/types";
import { useHostFeatures, usePhoneTranslation as useTranslation } from "./use-phone-host";
import { APPROVAL_CHOICES, STREAMING_CHOICES, WORKSPACE_CHOICES } from "@/lib/settings";
import { useAppStore } from "@/store/app-store";
import { Choices, SwitchRow } from "./MobileSettingsParts";

export type MacSettingsPage = "newConversations" | "sourceControl" | "agentBehavior" | "maintenance";

/**
 * The Mac's own settings, changed from the phone (ADR-130):
 * each choice is saved on the Mac through the same `saveSettings` as its Settings window, with
 * the same options and wording. Nothing can change while the Mac is out of reach.
 */
export function MobileMacSettings({ page, online }: { page: MacSettingsPage; online: boolean }) {
  const t = useTranslation();
  // A server has no in-app browser: its switch is left out (ADR-131).
  const features = useHostFeatures();
  const settings = useAppStore((state) => state.settings);
  const disabled = !online;
  const save = (patch: Partial<AppSettings>) => {
    if (disabled) return;
    const store = useAppStore.getState();
    void store.saveSettings({ ...store.settings, ...patch });
  };
  const footer = <p className="mobile-help">{t(online ? "phoneSettings.macHelp" : "phoneSettings.offline")}</p>;
  if (page === "newConversations") return <>
    <section>
      <h2>{t("settings.defaultApproval")}</h2>
      <Choices label={t("settings.defaultApproval")} value={settings.defaultApproval} disabled={disabled} onChange={(defaultApproval) => save({ defaultApproval })}
        options={APPROVAL_CHOICES.map((choice) => ({ id: choice.mode, title: t(choice.label), help: t(choice.help) }))} />
      <p className="mobile-help">{t("settings.defaultApprovalHelp")}</p>
    </section>
    <section>
      <h2>{t("Default session workspace")}</h2>
      <Choices label={t("Default session workspace")} value={settings.defaultSessionWorkspace} disabled={disabled} onChange={(defaultSessionWorkspace) => save({ defaultSessionWorkspace })}
        options={WORKSPACE_CHOICES.map((choice) => ({ id: choice.mode, title: t(choice.label), help: t(choice.help) }))} />
    </section>
    {footer}
  </>;
  if (page === "sourceControl") return <>
    <section>
      <h2>{t("phoneSettings.defaultBranch")}</h2>
      <div className="mobile-card">
        <SwitchRow icon={<Download size={19} />} label={t("settings.autoPull")} help={t("settings.autoPullHelp")} checked={settings.gitAutoPull} disabled={disabled} onChange={(gitAutoPull) => save({ gitAutoPull })} />
      </div>
    </section>
    <section>
      <h2>{t("phoneSettings.worktrees")}</h2>
      <div className="mobile-card">
        <SwitchRow icon={<GitFork size={19} />} label={t("settings.fromOrigin")} help={t("settings.fromOriginHelp")} checked={settings.worktreesFromOrigin} disabled={disabled} onChange={(worktreesFromOrigin) => save({ worktreesFromOrigin })} />
      </div>
    </section>
    {footer}
  </>;
  if (page === "agentBehavior") return <>
    <section>
      <h2>{t("settings.responseStreaming")}</h2>
      <Choices label={t("settings.responseStreaming")} value={settings.responseStreaming} disabled={disabled} onChange={(responseStreaming) => save({ responseStreaming })}
        options={STREAMING_CHOICES.map((choice) => ({ id: choice.mode, title: t(choice.label), help: t(choice.help) }))} />
      <p className="mobile-help">{t("settings.responseStreamingHelp")}</p>
    </section>
    {features.browser ? <section>
      <h2>{t("phoneSettings.browser")}</h2>
      <div className="mobile-card">
        <SwitchRow icon={<Globe size={19} />} label={t("settings.browserAccess")} help={t("settings.browserAccessHelp")} checked={settings.agentBrowserAccess} disabled={disabled} onChange={(agentBrowserAccess) => save({ agentBrowserAccess })} />
      </div>
    </section> : null}
    {footer}
  </>;
  return <>
    <section>
      <h2>{t("phoneSettings.updates")}</h2>
      <div className="mobile-card">
        <SwitchRow icon={<RefreshCw size={19} />} label={t("Check for CLI updates")} help={t("Check Codex, Claude and other provider CLIs for newer versions in the background.")} checked={settings.enableProviderUpdateChecks} disabled={disabled}
          onChange={(enableProviderUpdateChecks) => save({ enableProviderUpdateChecks })} />
        <SwitchRow icon={<RotateCcw size={19} />} label={t("chatBehavior.continueInterrupted")} help={t("chatBehavior.continueInterruptedHelp")} checked={settings.continueInterruptedSessions} disabled={disabled}
          onChange={(continueInterruptedSessions) => save({ continueInterruptedSessions })} />
      </div>
    </section>
    {footer}
  </>;
}
