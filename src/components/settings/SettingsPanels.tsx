import { useTranslation } from "@/i18n/use-translation";
import type { AgentInstall, AgentProviderId, AppSettings, HostInfo, WorktreeLeftoverScan } from "@/client/types";
import { formatDiskSize } from "@/lib/project-scripts";
import { client } from "@/client";
import { RefreshCw } from "@/components/icons/phosphor";
import "@/styles/general-settings.css";
import { KeybindingsSettings } from "./KeybindingsSettings";
import { ProviderRow } from "@/components/settings/ProviderRow";
import { ComputerSettings } from "@/components/settings/ComputerSettings";
import { ConnectionsSettings } from "@/components/settings/ConnectionsSettings";
import { SettingsGroup, SettingsRow, SettingsSection } from "@/components/settings/SettingsSection";
import { AppearanceSettings, FontSizeControl, MonoFontControl } from "./AppearanceSettings";
import { ChatBehaviorSettings } from "@/components/settings/ChatBehaviorSettings";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { NotificationSettings } from "./NotificationSettings";
import { SkillsSettings } from "./SkillsSettings";
import { McpSettings } from "./McpSettings";
import { PROVIDERS } from "@/lib/providers";
import { defaultSettings, isProviderEnabled, type SettingsSectionId } from "@/lib/settings";
import { translate } from "@/i18n";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { SegmentedControl } from "@/primitives/SegmentedControl";
import { Switch } from "@/primitives/Switch";
import { useAppStore } from "@/store/app-store";
import { SIDEBAR_MIN_WIDTH } from "@/lib/sidebar-panels";
import { SIDEBAR_USAGE_LIMIT, USAGE_PROVIDER_IDS } from "@/lib/provider-usage";
import { lazy, Suspense, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/arc/dialog/dialog";

const ArcComponentExplorer = lazy(() => import("@/components/ArcComponentExplorer"));

export function SettingsPanels({
  section,
  settings,
  agents,
  host,
  onSave,
  onRefresh,
}: {
  section: SettingsSectionId;
  settings: AppSettings;
  agents: AgentInstall[];
  host: HostInfo | null;
  onSave: (settings: AppSettings) => void;
  onRefresh: () => void;
}) {
  const t = useTranslation();
  const installOf = (id: AgentProviderId) => agents.find((item) => item.id === id);

  if (section === "chat") return <ChatBehaviorSettings settings={settings} onSave={onSave} />;
  if (section === "general") {
    return <GeneralSettings settings={settings} agents={agents} onSave={onSave} />;
  }
  if (section === "notifications") return <NotificationSettings settings={settings} onSave={onSave} />;
  if (section === "skills") return <SkillsSettings settings={settings} />;
  if (section === "computer") return <ComputerSettings settings={settings} onSave={onSave} />;
  if (section === "connections") return <ConnectionsSettings locale={settings.locale} />;
  if (section === "mcp") return <McpSettings settings={settings} agents={agents} onSave={onSave} />;

  if (section === "providers") {
    return (
      <SettingsSection title={translate(settings.locale, "providers.title")} description={translate(settings.locale, "providers.description")}
        headerAction={<InteractiveButton variant="secondary" glow={false} onClick={() => { void useAppStore.getState().loadAllModels(true); onRefresh(); }}>
          <RefreshCw size={14} aria-hidden="true" />{translate(settings.locale, "providers.detectAgain")}
        </InteractiveButton>}>
        <div className="general-settings">
          <SettingsGroup title="CLIs" card>
            {PROVIDERS.map((definition) => (
              <ProviderRow
                key={definition.id}
                definition={definition}
                install={installOf(definition.id)}
                enabled={isProviderEnabled(settings, definition.id)}
                onEnabledChange={(value) => {
                  const disabledProviders = value
                    ? settings.disabledProviders.filter((item) => item !== definition.id)
                    : [...new Set([...settings.disabledProviders, definition.id])];
                  onSave({ ...settings, disabledProviders });
                }}
              />
            ))}
          </SettingsGroup>
          <SidebarUsageSettings settings={settings} agents={agents} onSave={onSave} />
          <SettingsGroup title={t("Updates")} card>
            <SettingsRow
              title={t("Check for CLI updates")}
              description={t("Check Codex, Claude and other provider CLIs for newer versions in the background.")}
            >
              <Switch checked={settings.enableProviderUpdateChecks} onChange={(enableProviderUpdateChecks) => onSave({ ...settings, enableProviderUpdateChecks })} />
            </SettingsRow>
          </SettingsGroup>
        </div>
      </SettingsSection>
    );
  }

  if (section === "appearance") return <AppearanceSettings settings={settings} host={host} onSave={onSave} />;

  if (section === "git") {
    return (
      <SettingsSection title={t("Git")}>
        <div className="general-settings">
        <SettingsGroup title={t("Installation")} card>
          <SettingsRow title={t("Git detected")}>
            <span className={host?.gitDetected ? "text-success" : "text-text-muted"}>
              {host ? t(host.gitDetected ? "Yes" : "No") : "—"}
            </span>
          </SettingsRow>
          <SettingsRow title={t("Version")}>
            <span className="font-mono ui-control text-text-secondary">{host?.gitVersion ?? "—"}</span>
          </SettingsRow>
          <SettingsRow title={t("Executable")}>
            <span className="max-w-[360px] truncate font-mono ui-control text-text-secondary">
              {host?.gitPath ?? "—"}
            </span>
          </SettingsRow>
        </SettingsGroup>
        <SettingsGroup title={t("Behavior")} card>
          <SettingsRow title={t("Automatically fetch when opening project")} description={t("Automatic fetch is unavailable while project Git configuration can execute helpers or disclose credentials. Fetch manually in your terminal.")} comingSoon>
            <Switch checked={false} onChange={() => undefined} disabled />
          </SettingsRow>
          <SettingsRow title={t("ciFix.setting")} description={t("ciFix.settingHelp")}>
            <Switch checked={settings.ciAutoFix} label={t("ciFix.setting")} onChange={(ciAutoFix) => onSave({ ...settings, ciAutoFix })} />
          </SettingsRow>
          <SettingsRow title={t("prWatch.setting")} description={t("prWatch.settingHelp")}>
            <Switch checked={settings.prWatch} label={t("prWatch.setting")} onChange={(prWatch) => onSave({ ...settings, prWatch })} />
          </SettingsRow>
          <SettingsRow title={t("Show untracked files")}>
            <Switch checked={settings.gitShowUntracked} onChange={(gitShowUntracked) => onSave({ ...settings, gitShowUntracked })} />
          </SettingsRow>
          <SettingsRow
            title={t("Confirm destructive Git actions")}
            description={t("Cannot be turned off. Sirus Code never runs reset --hard, clean -fd, or worktree remove --force automatically.")}
          >
            <Switch checked onChange={() => undefined} disabled />
          </SettingsRow>
        </SettingsGroup>
        </div>
      </SettingsSection>
    );
  }

  if (section === "worktrees") {
    return (
      <SettingsSection title={t("Worktrees")}>
        <div className="general-settings">
        <SettingsGroup title={t("Defaults")} card>
          <SettingsRow title={t("Default session workspace")}>
            <SegmentedControl
              value={settings.defaultSessionWorkspace}
              onChange={(defaultSessionWorkspace) => onSave({ ...settings, defaultSessionWorkspace })}
              options={[
                { value: "ask", label: t("Ask every time") },
                { value: "checkout", label: t("Current checkout") },
                { value: "worktree", label: t("New worktree") },
              ]}
            />
          </SettingsRow>
          <SettingsRow title={t("Worktree location")}>
            <SegmentedControl
              value={settings.worktreeLocation}
              onChange={(worktreeLocation) => onSave({ ...settings, worktreeLocation })}
              options={[
                { value: "automatic", label: t("Automatic") },
                { value: "custom", label: t("Custom") },
              ]}
            />
          </SettingsRow>
          {settings.worktreeLocation === "custom" ? (
            <SettingsRow title={t("Custom directory")} description={settings.worktreeBasePath ?? t("Not set")}>
              <InteractiveButton
                variant="toolbar"
                onClick={async () => {
                  const path = await client.pickFolder();
                  if (path) onSave({ ...settings, worktreeBasePath: path });
                }}
              >{t("Choose")}</InteractiveButton>
            </SettingsRow>
          ) : (
            <SettingsRow title={t("Automatic directory")} description={host?.worktreeRoot ?? "Application Support / worktrees"}>
              <span />
            </SettingsRow>
          )}
          <SettingsRow title={t("Branch naming pattern")} description={t("Tokens: {session-name} {id}")}>
            <input
              value={settings.worktreeBranchPattern}
              onChange={(event) => onSave({ ...settings, worktreeBranchPattern: event.target.value })}
              className="h-8 w-[240px] rounded-[var(--radius-md)] border border-border-subtle bg-background-1 px-2.5 font-mono ui-control outline-none focus:border-border-default"
            />
          </SettingsRow>
        </SettingsGroup>
        <SettingsGroup title={t("Cleanup")} card>
          <SettingsRow
            title={t("Clean up completed worktrees")}
            description={t("Removes isolated worktrees for completed, failed, or stopped sessions. Dirty trees are refused without --force.")}
          >
            <CleanupButton />
          </SettingsRow>
          <SettingsRow title={t("worktreeCleanup.leftovers")} description={t("worktreeCleanup.leftoversHelp")}>
            <LeftoverCleanupButton />
          </SettingsRow>
          <SettingsRow title={t("worktreeCleanup.release")} description={t("worktreeCleanup.releaseHelp")}>
            <Switch checked={settings.releaseWorktreeOnArchive} label={t("worktreeCleanup.release")} onChange={(releaseWorktreeOnArchive) => onSave({ ...settings, releaseWorktreeOnArchive })} />
          </SettingsRow>
        </SettingsGroup>
        </div>
      </SettingsSection>
    );
  }

  if (section === "terminal") {
    return (
      <SettingsSection title={t("Terminal")}>
        <div className="general-settings">
        <SettingsGroup title={t("Shell")} card>
          <SettingsRow title={t("Default shell")} description={host?.shell ?? t("Unknown")}>
            <span className="font-mono ui-control text-text-secondary">{host?.shell ?? "—"}</span>
          </SettingsRow>
          <SettingsRow title={t("Use system default shell")} description={t("The PTY always launches $SHELL. This cannot be changed.")}>
            <Switch checked onChange={() => undefined} disabled />
          </SettingsRow>
          <SettingsRow title={t("Working directory behavior")}>
            <span className="ui-control text-text-muted">{t("Session workspace")}</span>
          </SettingsRow>
        </SettingsGroup>
        <SettingsGroup title={t("Display")} card>
          <SettingsRow title={t("Terminal font")}><MonoFontControl label={t("Terminal font")} value={settings.terminalFont} onChange={terminalFont => onSave({ ...settings, terminalFont })} /></SettingsRow>
          <SettingsRow title={t("Terminal font size")}>
            <FontSizeControl label={t("Terminal font size")} value={settings.terminalFontSize} onChange={terminalFontSize => onSave({ ...settings, terminalFontSize })} />
          </SettingsRow>
          <SettingsRow title={t("Cursor style")}>
            <SegmentedControl value={settings.terminalCursorStyle} onChange={(terminalCursorStyle) => onSave({ ...settings, terminalCursorStyle })} options={["block", "bar", "underline"].map((value) => ({ value, label: t(value) }))} />
          </SettingsRow>
          <SettingsRow title={t("Scrollback limit")}>
            <SegmentedControl value={String(settings.terminalScrollback)} onChange={(value) => onSave({ ...settings, terminalScrollback: Number(value) })} options={[2000, 5000, 10000].map((value) => ({ value: String(value), label: String(value) }))} />
          </SettingsRow>
        </SettingsGroup>
        </div>
      </SettingsSection>
    );
  }

  if (section === "keybindings") return <KeybindingsSettings settings={settings} />;

  return (
    <SettingsSection title={t("Advanced")}>
        <div className="general-settings">
      <SettingsGroup title={t("Diagnostics")} card>
        <SettingsRow title={t("Developer logs")} description={t("Stores bounded lifecycle counts locally. Prompts, output, paths and credentials are excluded.")}>
          <Switch checked={settings.developerLogs} onChange={(developerLogs) => onSave({ ...settings, developerLogs })} />
        </SettingsRow>
        <SettingsRow title={t("Open Sirus Code data directory")} description={host?.dataDir ?? ""}>
          <InteractiveButton
            variant="toolbar"
            disabled={!host?.dataDir}
            onClick={() => host?.dataDir && void client.openPath(host.dataDir)}
          >{t("Open")}</InteractiveButton>
        </SettingsRow>
        <SettingsRow title={t("Open logs folder")}>
          <InteractiveButton variant="toolbar" disabled={!host?.dataDir || !settings.developerLogs} onClick={() => host?.dataDir && void client.openPath(`${host.dataDir}/logs`).catch((error: unknown) => useAppStore.setState({ error: String(error) }))}>{t("Open")}</InteractiveButton>
        </SettingsRow>
        <SettingsRow title={t("Reset window layout")} description={t("Clears sidebar collapse and panel widths in this session.")}>
          <ResetLayoutButton />
        </SettingsRow>
        <SettingsRow title={t("UI Arc components")} description={t("Explore all 100 free components with local examples.")}>
          <ArcExplorerButton />
        </SettingsRow>
        <SettingsRow title={t("Experimental features")} comingSoon>
          <Switch checked={false} onChange={() => undefined} disabled />
        </SettingsRow>
      </SettingsGroup>
      <div className="rounded-[var(--radius-lg)] border border-danger/25 px-4 py-4">
        <p className="ui-body text-danger">{t("Danger Zone")}</p>
        <p className="mt-1 ui-control text-text-muted">{t("Resetting settings does not delete projects on disk. Confirmation is required.")}</p>
        <div className="mt-3">
          <ResetSettingsButton />
        </div>
      </div>
      </div>
    </SettingsSection>
  );
}

function CleanupButton() {
  const t = useTranslation();
  const sessions = useAppStore((state) => state.sessions);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const done = sessions.filter(
    (session) =>
      session.worktree.isolated &&
      (session.status === "completed" || session.status === "failed" || session.status === "stopped"),
  );
  return (
    <>
    <InteractiveButton
      variant="toolbar"
      disabled={busy || done.length === 0}
      onClick={() => setConfirming(true)}
    >
      {done.length === 0 ? t("cleanup.none") : t("cleanup.action", { count: done.length })}
    </InteractiveButton>
    <ConfirmDialog
      open={confirming}
      onOpenChange={setConfirming}
      busy={busy}
      title={t("Clean up completed worktrees")}
      description={t("cleanup.confirm", { count: done.length })}
      confirmLabel={t("cleanup.action", { count: done.length })}
      onConfirm={async () => {
        setBusy(true);
        try {
          for (const session of done) {
            await client.deleteSession(session.id, true, true);
            useAppStore.setState((state) => ({
              sessions: state.sessions.filter((item) => item.id !== session.id),
              ...(state.selectedSessionId === session.id ? { selectedSessionId: null, gitStatus: null, selectedDiff: null, diffText: null } : {}),
            }));
          }
        } catch (error) {
          useAppStore.setState({ error: error instanceof Error ? error.message : String(error) });
        } finally {
          setBusy(false);
        }
      }}
    />
    </>
  );
}

/** Leftover folders under the worktree location (ADR-078): check, then confirm what it frees. */
function LeftoverCleanupButton() {
  const t = useTranslation();
  const [scan, setScan] = useState<WorktreeLeftoverScan | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const fail = (error: unknown) => useAppStore.setState({ error: error instanceof Error ? error.message : String(error) });
  const check = async () => {
    setBusy(true);
    setDone(null);
    try { setScan(await client.scanLeftoverWorktrees()); } catch (error) { fail(error); } finally { setBusy(false); }
  };
  const removable = scan?.leftovers.filter((item) => !item.kept) ?? [];
  const kept = (scan?.leftovers.length ?? 0) - removable.length;
  const size = formatDiskSize(scan?.reclaimableBytes ?? 0);
  return <div className="flex flex-col items-end gap-1">
    <InteractiveButton variant="toolbar" loading={busy && !confirming} disabled={busy || (scan !== null && removable.length === 0)} onClick={() => { if (scan && removable.length) setConfirming(true); else void check(); }}>
      {busy && !confirming ? t("worktreeCleanup.scanning") : !scan ? t("worktreeCleanup.scan") : removable.length ? t("worktreeCleanup.action", { size }) : t("worktreeCleanup.none")}
    </InteractiveButton>
    {done ? <span role="status" className="ui-caption text-text-muted">{done}</span> : scan && kept > 0 ? <span className="ui-caption text-text-muted">{t("worktreeCleanup.keptCount", { count: String(kept) })}</span> : null}
    <ConfirmDialog open={confirming} onOpenChange={setConfirming} busy={busy} title={t("worktreeCleanup.leftovers")}
      description={t("worktreeCleanup.confirm", { count: String(removable.length), size })} confirmLabel={t("worktreeCleanup.action", { size })}
      onConfirm={async () => {
        setBusy(true);
        try {
          const result = await client.cleanLeftoverWorktrees();
          setDone(t("worktreeCleanup.done", { size: formatDiskSize(result.freedBytes), count: String(result.removed) }));
          setScan(null);
        } catch (error) { fail(error); return false; } finally { setBusy(false); }
      }} />
  </div>;
}

function ResetLayoutButton() {
  const t = useTranslation();
  return (
    <InteractiveButton
      variant="toolbar"
      onClick={() => {
        void useAppStore.getState().saveSettings({ ...useAppStore.getState().settings, sidebarCollapsed: false });
        useAppStore.setState({
          sidebarCollapsed: false,
          sidebarWidth: SIDEBAR_MIN_WIDTH,
          dockOpen: false,
          dockWidth: 360,
          dockMaximized: false,
        });
      }}
    >{t("Reset")}</InteractiveButton>
  );
}

function ResetSettingsButton() {
  const t = useTranslation();
  const saveSettings = useAppStore((state) => state.saveSettings);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
    <InteractiveButton
      variant="secondary"
      className="text-danger"
      onClick={() => setConfirming(true)}
    >{t("Reset Sirus Code settings")}</InteractiveButton>
    <ConfirmDialog
      open={confirming}
      onOpenChange={setConfirming}
      title={t("Reset Sirus Code settings")}
      description={t("settings.resetConfirm")}
      confirmLabel={t("Reset")}
      onConfirm={() => saveSettings({ ...defaultSettings, defaultAgent: useAppStore.getState().settings.defaultAgent })}
    />
    </>
  );
}


function ArcExplorerButton() {
  const t = useTranslation();
  const locale = useAppStore((state) => state.settings.locale);
  const [open, setOpen] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><InteractiveButton variant="toolbar">{t("Explore")}</InteractiveButton></DialogTrigger>
    <DialogContent title={t("UI Arc components")} description={t("Explore all 100 free components with local examples.")} className="w-[min(1100px,calc(100vw-32px))]" onEscapeKeyDown={(event) => {
      if (content.current?.querySelector('[data-arc-menu-open="true"]')) event.preventDefault();
    }}>
      <div ref={content} className="flex h-[min(640px,calc(100dvh-200px))] min-h-0">
        <Suspense fallback={<p role="status">{t("common.loading")}</p>}>
          {open ? <ArcComponentExplorer locale={locale} onClose={() => setOpen(false)} /> : null}
        </Suspense>
      </div>
    </DialogContent>
  </Dialog>;
}

/** Up to two providers whose quota ring shows in the sidebar rail. */
function SidebarUsageSettings({ settings, agents, onSave }: { settings: AppSettings; agents: AgentInstall[]; onSave: (settings: AppSettings) => void }) {
  const t = useTranslation();
  const chosen = settings.sidebarUsageProviders;
  const full = chosen.length >= SIDEBAR_USAGE_LIMIT;
  return <SettingsGroup title={t("sidebarUsage.title")} card>
    {PROVIDERS.filter((definition) => USAGE_PROVIDER_IDS.includes(definition.id)).map((definition) => {
      const on = chosen.includes(definition.id);
      const installed = agents.some((agent) => agent.id === definition.id && agent.installed);
      return <SettingsRow key={definition.id} title={definition.name} description={!installed ? t("sidebarUsage.notInstalled") : !on && full ? t("sidebarUsage.limit") : undefined}>
        <Switch checked={on} disabled={!on && (full || !installed)} onChange={(value) => onSave({ ...settings, sidebarUsageProviders: value ? [...chosen, definition.id].slice(0, SIDEBAR_USAGE_LIMIT) : chosen.filter((id) => id !== definition.id) })} />
      </SettingsRow>;
    })}
    <p className="px-1 pt-2 ui-caption text-text-muted">{t("sidebarUsage.description")}</p>
  </SettingsGroup>;
}
