import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpFromLine,
  ChevronDown,
  ExternalLink,
  FileCode2,
  FolderOpen,
  GitBranch,
  GitCompareArrows,
  Globe,
  Hammer,
  Laptop,
  MessagesSquare,
  MousePointer2,
  RefreshCw,
  Settings2,
  SquareTerminal,
  Trash2,
} from "@/components/icons/phosphor";
import { client } from "@/client";
import type { AgentProviderId, EditorId, GitWorktree } from "@/client/types";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { GitHubIcon } from "@/components/icons/BrandIcons";
import { WindowIcon } from "@/components/icons/WindowIcon";
import { EnvironmentPullRequestSection } from "@/components/EnvironmentPullRequestSection";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { primaryUsageWindow, usageWindowLabel } from "@/lib/provider-usage";
import { cn } from "@/lib/cn";
import { motionTokens } from "@/lib/motion";
import { PROVIDERS } from "@/lib/provider-registry";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { effectiveShortcut, shortcutLabel } from "@/lib/keybindings";
import { selectCurrentProject, useAppStore, selectCurrentSessionMeta } from "@/store/app-store";

export function EnvironmentToggle() {
  const t = useTranslation();
  const open = useAppStore((state) => state.environmentOpen);
  const toggle = useAppStore((state) => state.toggleEnvironment);
  return (
    <button
      type="button"
      data-environment-toggle
      aria-label={t("Environment")}
      aria-expanded={open}
      title={t("Environment")}
      className={cn(
        "flex size-6 items-center justify-center rounded-[6px] text-text-muted hover:bg-background-3 hover:text-text-primary",
        open && "bg-background-3 text-text-primary",
      )}
      onClick={toggle}
    >
      <WindowIcon size={14} />
    </button>
  );
}

/** Card overlay pinned to the top-right of the content column, like Synara's environment panel. */
export function EnvironmentPanel() {
  const open = useAppStore((state) => state.environmentOpen);
  const setOpen = useAppStore((state) => state.setEnvironmentOpen);

  // Fixed window, not a popup: it stays open until the toggle, Escape or an
  // action closes it. Clicks elsewhere keep reaching the app.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="pointer-events-none absolute inset-y-0 right-0 z-20 flex flex-col p-[12px]"
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 16 }}
          transition={{ duration: motionTokens.fast, ease: motionTokens.ease }}
        >
          <div className="floating-material pointer-events-auto flex max-h-full w-[288px] flex-col overflow-hidden rounded-[16px] border border-border-default bg-background-1 shadow-[var(--shadow-float)]">
            <EnvironmentPanelContent onClose={() => setOpen(false)} />
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function EnvironmentPanelContent({ onClose }: { onClose: () => void }) {
  const t = useTranslation();
  const session = useAppStore(selectCurrentSessionMeta);
  const project = useAppStore(selectCurrentProject);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const openDockPane = useAppStore((state) => state.openDockPane);
  const selectedFile = useAppStore((state) => (session ? state.selectedFileBySession[session.id] : undefined));
  const loadProjectRemote = useAppStore((state) => state.loadProjectRemote);
  const showUsage = useAppStore((state) => state.settings.showEnvironmentUsage);
  const showRepository = useAppStore((state) => state.settings.showEnvironmentRepository);
  const showEditor = useAppStore((state) => state.settings.showEnvironmentEditor);
  const showPullRequest = useAppStore((state) => state.settings.showEnvironmentPullRequest);

  useEffect(() => {
    if (project && showRepository) void loadProjectRemote(project.id);
  }, [project, showRepository, loadProjectRemote]);

  if (!session || !project) {
    return <p className="px-3 py-4 ui-control text-text-muted">{t("Select a session.")}</p>;
  }
  return (
    <div className="scroll-thin min-h-0 overflow-y-auto">
      <div className="flex flex-col gap-[2px] p-[6px]">
        <div className="flex items-center justify-between gap-[8px] px-[8px] py-[2px]">
          <span className="ui-body text-text-muted">{t("Environment")}</span>
          <button
            type="button"
            aria-label={t("Settings")}
            className="rounded-[6px] p-0.5 text-text-muted hover:bg-background-3 hover:text-text-primary"
            onClick={() => {
              onClose();
              setSettingsOpen(true);
            }}
          >
            <Settings2 size={14} />
          </button>
        </div>
        <Row
          icon={<GitCompareArrows size={14} />}
          label={t("Changes")}
          trailing={<ChangeTotals />}
          onClick={() => {
            openDockPane("changes");
            onClose();
          }}
        />
        <LocalRow sessionId={session.id} />
        <BranchRow projectId={project.id} branch={session.worktree.branch} />
        <CommitAndPushSection sessionId={session.id} projectPath={project.path} />
        <LocalServersSection sessionId={session.id} />
        <SideChatRow parentSessionId={session.id} onClose={onClose} />
        {showUsage && <><Divider />
        <Section title={t("Usage")}>
          <UsageSection />
        </Section></>}
        {showRepository && <><Divider />
        <Section title={t("Repository")}>
          <RepositoryRow projectId={project.id} name={project.name} path={project.path} />
        </Section></>}
        {showPullRequest && <EnvironmentPullRequestSection key={`${session.id}:${session.worktree.path}`} session={session} />}
        {showEditor && <><Divider />
        <Section title={t("Editor")}>
          <Row
            icon={<FileCode2 size={14} />}
            label={t("Editor view")}
            onClick={() => {
              if (selectedFile) openDockPane("editor", selectedFile);
              else openDockPane("files");
              onClose();
            }}
          />
          <EditorOpenSection sessionId={session.id} path={selectedFile ?? null} onClose={onClose} />
        </Section></>}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="my-[4px] border-t border-border-subtle" />;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <SectionLabel>{title}</SectionLabel>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="px-[8px] py-[4px] ui-control text-text-muted">{children}</p>;
}

function Row({
  icon,
  label,
  trailing,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-[8px] rounded-[8px] px-[8px] py-[4px] text-left ui-body text-text-secondary hover:bg-background-3 hover:text-text-primary"
    >
      <span className="shrink-0 text-text-muted [&_svg]:size-[16px]" aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

function Expandable({
  icon,
  label,
  trailing,
  children,
  defaultOpen = false,
}: {
  icon: ReactNode;
  label: string;
  trailing?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-[8px] rounded-[8px] px-[8px] py-[4px] text-left ui-body text-text-secondary hover:bg-background-3 hover:text-text-primary"
      >
        <span className="shrink-0 text-text-muted [&_svg]:size-[16px]" aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trailing}
        <ChevronDown size={12} aria-hidden="true" className={cn("shrink-0 text-text-muted opacity-60 transition-transform", open && "rotate-180")} />
      </button>
      <Reveal open={open}><div className="flex flex-col gap-[4px] px-[8px] pb-[4px] pt-[2px]">{children}</div></Reveal>
    </>
  );
}

/** Opens and closes a section by animating its height (reduced motion makes it instant). */
function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  return <AnimatePresence initial={false}>
    {open ? <motion.div key="reveal" className="overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
      transition={{ duration: motionTokens.normal, ease: motionTokens.ease }}>{children}</motion.div> : null}
  </AnimatePresence>;
}

/** Real added/removed line totals of the selected session's working tree, when Git reports changes. */
function ChangeTotals() {
  const changes = useAppStore((state) => state.gitStatus?.changes);
  if (!changes?.length) return null;
  const added = changes.reduce((sum, change) => sum + change.additions, 0);
  const removed = changes.reduce((sum, change) => sum + change.deletions, 0);
  return <span className="flex shrink-0 items-center gap-1.5 ui-caption tabular-nums">
    {added || removed ? <><span className="text-success">+{added}</span><span className="text-danger">−{removed}</span></> : <span className="text-text-muted">{changes.length}</span>}
  </span>;
}

function LocalRow({ sessionId }: { sessionId: string }) {
  const t = useTranslation();
  const session = useAppStore((state) => state.sessions.find((item) => item.id === sessionId));
  const [error, setError] = useState<string | null>(null);
  if (!session) return null;
  return (
    <Expandable icon={<Laptop size={14} />} label={t(session.worktree.isolated ? "Isolated worktree" : "Local workspace")}>
      <p className="selectable break-all font-mono ui-micro text-text-muted">{session.worktree.path}</p>
      <div className="mt-1 flex items-center gap-1">
        <CopyButton value={session.worktree.path} label={t("Copy path")} iconOnly variant="plain" />
        <InteractiveButton
          variant="toolbar"
          onClick={() =>
            void client.openPath(session.worktree.path).catch((reason: unknown) => setError(formatUnknownError(reason)))
          }
        >
          <FolderOpen size={12} /> {t("Open folder")}
        </InteractiveButton>
      </div>
      {error ? <p role="alert" className="mt-1 ui-caption text-danger">{error}</p> : null}
    </Expandable>
  );
}

function BranchRow({ projectId, branch }: { projectId: string; branch: string }) {
  return (
    <Expandable icon={<GitBranch size={14} />} label={branch}>
      <WorktreeList projectId={projectId} />
    </Expandable>
  );
}

function WorktreeList({ projectId }: { projectId: string }) {
  const t = useTranslation();
  const [entries, setEntries] = useState<GitWorktree[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    client
      .listWorktrees(projectId)
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(formatUnknownError(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  if (error) return <p role="alert" className="ui-caption text-danger">{error}</p>;
  if (!entries) return <p className="ui-caption text-text-muted">{t("common.loading")}</p>;
  return (
    <div className="space-y-1.5">
      {entries.map((tree) => (
        <div key={tree.path}>
          <p className="truncate ui-caption text-text-secondary">{tree.branch ?? (tree.detached ? t("Detached HEAD") : t("Bare repository"))}</p>
          <p className="selectable break-all font-mono ui-micro text-text-muted">{tree.path}</p>
        </div>
      ))}
    </div>
  );
}

function CommitAndPushSection({ sessionId, projectPath }: { sessionId: string; projectPath: string }) {
  const t = useTranslation();
  const isRepo = useAppStore((state) => state.gitByPath[projectPath]?.isRepo ?? state.gitStatus?.identity.isRepo ?? false);
  const ahead = useAppStore((state) => state.gitStatus?.ahead ?? 0);
  const refreshGitStatus = useAppStore((state) => state.refreshGitStatus);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"commit" | "push" | null>(null);
  const [confirmPush, setConfirmPush] = useState(false);
  const [result, setResult] = useState<{ error: boolean; text: string } | null>(null);

  if (!isRepo) return null;

  const run = async (kind: "commit" | "push") => {
    setBusy(kind);
    setResult(null);
    try {
      if (kind === "commit") {
        const committed = await client.gitCommit(sessionId, message);
        setMessage("");
        setResult({ error: false, text: committed.summary || committed.hash.slice(0, 8) });
      } else {
        const pushed = await client.gitPush(sessionId);
        setResult({ error: false, text: t("Pushed {branch}", { branch: pushed.branch }) });
      }
      setConfirmPush(false);
      await refreshGitStatus();
    } catch (reason) {
      setResult({ error: true, text: formatUnknownError(reason) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Expandable
      icon={<ArrowUpFromLine size={14} />}
      label={t("Commit and Push")}
      trailing={ahead > 0 ? <span className="ui-caption text-text-muted">{t("{count} ahead", { count: ahead })}</span> : undefined}
    >
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder={t("Commit message")}
        rows={2}
        className="w-full resize-none rounded-[7px] border border-border-subtle bg-background-2 px-[8px] py-[6px] ui-body text-text-primary placeholder:text-text-muted focus-visible:border-border-default focus-visible:outline-none"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <InteractiveButton variant="toolbar" disabled={!message.trim() || busy !== null} onClick={() => void run("commit")}>
          {busy === "commit" ? t("Committing…") : t("Commit")}
        </InteractiveButton>
        {confirmPush ? (
          <>
            <InteractiveButton variant="toolbar" disabled={busy !== null} onClick={() => void run("push")}>
              {busy === "push" ? t("Pushing…") : t("Confirm push")}
            </InteractiveButton>
            <InteractiveButton variant="toolbar" disabled={busy !== null} onClick={() => setConfirmPush(false)}>
              {t("common.cancel")}
            </InteractiveButton>
          </>
        ) : (
          <InteractiveButton variant="toolbar" disabled={busy !== null} onClick={() => setConfirmPush(true)}>
            {t("Push")}
          </InteractiveButton>
        )}
      </div>
      {result ? (
        <p role={result.error ? "alert" : "status"} className={cn("mt-1.5 break-words ui-caption", result.error ? "text-danger" : "text-text-muted")}>
          {t(result.text)}
        </p>
      ) : null}
    </Expandable>
  );
}

/** The session's side chat (ADR-049): open it, or remove an idle one. */
function SideChatRow({ parentSessionId, onClose }: { parentSessionId: string; onClose: () => void }) {
  const t = useTranslation();
  const side = useAppStore((state) => state.sessions.find((session) => session.sideChat?.parentSessionId === parentSessionId));
  const shortcut = useAppStore((state) => shortcutLabel(effectiveShortcut(state.settings.customShortcuts, "toggle-side-chat")));
  const running = side ? ["starting", "running", "waiting"].includes(side.status) : false;
  const open = () => { onClose(); void useAppStore.getState().openSideChat(parentSessionId); };
  const count = side?.transcriptLength ?? side?.messages.filter((message) => message.role !== "system").length ?? 0;
  return <div className="group flex w-full items-center rounded-[8px] hover:bg-background-3">
    <button type="button" onClick={open} className="flex min-w-0 flex-1 items-center gap-[8px] px-[8px] py-[4px] text-left ui-body text-text-secondary hover:text-text-primary">
      <span className="shrink-0 text-text-muted [&_svg]:size-[16px]" aria-hidden="true"><MessagesSquare size={14} /></span>
      <span className="min-w-0 flex-1 truncate">{t(side ? "sideChat.title" : "sideChat.open")}</span>
      {running ? <span className="ui-caption text-text-muted">{t("sideChat.working")}</span>
        : side && count ? <span className="ui-caption tabular-nums text-text-muted">{t("sideChat.messages", { count })}</span>
        : <kbd className="ui-caption text-text-muted">{shortcut}</kbd>}
    </button>
    {side && !running ? <button type="button" aria-label={t("sideChat.delete")} title={t("sideChat.delete")}
      className="mr-1 rounded-[6px] p-1 text-text-muted opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
      onClick={() => void useAppStore.getState().deleteSession(side.id, false)}><Trash2 size={13} /></button> : null}
  </div>;
}

function LocalServersSection({ sessionId }: { sessionId: string }) {
  const t = useTranslation();
  const servers = useAppStore((state) => state.localServersBySession[sessionId]) ?? [];
  const setStoreError = (message: string) => useAppStore.setState({ error: message });
  return (
    <Expandable
      icon={<Globe size={14} />}
      label={t("Local Servers")}
      trailing={servers.length ? <span className="mr-1 flex items-center gap-1.5 ui-caption tabular-nums text-text-muted"><span className="size-1.5 rounded-full bg-success shadow-[0_0_6px_var(--success)]" aria-hidden="true" />{servers.length}</span> : undefined}
    >
      {servers.length === 0 ? (
        <p className="ui-caption text-text-muted">{t("No local servers detected.")}</p>
      ) : (
        <div className="space-y-0.5">
          {servers.map((url) => (
            <button
              key={url}
              type="button"
              className="flex w-full items-center gap-[6px] rounded-[8px] px-[8px] py-[4px] text-left hover:bg-background-3"
              onClick={() => void client.openExternalUrl(url).catch((reason: unknown) => setStoreError(formatUnknownError(reason)))}
            >
              <span className="min-w-0 flex-1 truncate font-mono ui-micro text-text-secondary">{url}</span>
              <ExternalLink size={11} className="shrink-0 text-text-muted" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </Expandable>
  );
}

function UsageSection() {
  const t = useTranslation();
  const session = useAppStore(selectCurrentSessionMeta);
  const settings = useAppStore((state) => state.settings);
  const usage = useAppStore((state) => state.usageByProvider);
  const refresh = useAppStore((state) => state.refreshProviderUsage);
  const provider: AgentProviderId = session?.agent ?? settings.defaultAgent;
  const name = PROVIDERS.find((item) => item.id === provider)?.name ?? provider;
  const current = usage[provider];
  const main = primaryUsageWindow(current);
  const used = main?.usedPercent;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) void refresh(provider);
  }, [open, provider, refresh]);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-[8px] rounded-[8px] px-[8px] py-[4px] text-left ui-body text-text-secondary hover:bg-background-3 hover:text-text-primary"
      >
        <ProviderIcon id={provider} size={16} className="shrink-0 bg-transparent" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {used != null ? <span className="flex items-center gap-2 tabular-nums text-text-muted"><span className="h-1 w-10 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text-primary)_14%,transparent)]" aria-hidden="true"><span className={cn("block h-full rounded-full", used >= 90 ? "bg-danger" : "bg-text-secondary")} style={{ width: `${Math.min(100, used)}%` }} /></span>{Math.round(used)}%</span> : <span className="text-text-muted">{t("Usage unavailable")}</span>}
        <ChevronDown size={12} aria-hidden="true" className={cn("shrink-0 text-text-muted opacity-60 transition-transform", open && "rotate-180")} />
      </button>
      <Reveal open={open}>
        <div className="flex flex-col gap-[4px] px-[8px] pb-[4px] pt-[2px]">
          {current?.windows.map((window) => (
            <div key={window.id} className="mb-1.5">
              <div className="flex justify-between gap-3 ui-caption text-text-secondary">
                <span>{t(usageWindowLabel(window))}</span>
                <span className="tabular-nums">{window.usedPercent == null ? "—" : `${Math.round(window.usedPercent)}%`}</span>
              </div>
              {window.usedPercent != null ? (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-background-3">
                  <div className="h-full rounded-full bg-text-secondary" style={{ width: `${window.usedPercent}%` }} />
                </div>
              ) : null}
            </div>
          ))}
          {!current ? <p className="ui-caption text-text-muted">{t("common.loading")}</p> : null}
          <InteractiveButton variant="toolbar" onClick={() => void refresh(provider, true)}>
            <RefreshCw size={12} /> {t("Refresh usage")}
          </InteractiveButton>
        </div>
      </Reveal>
    </>
  );
}

function RepositoryRow({ projectId, name, path }: { projectId: string; name: string; path: string }) {
  const project = useAppStore(selectCurrentProject);
  const remote = useAppStore((state) => state.remoteUrlByProject[projectId]);
  const setStoreError = (message: string) => useAppStore.setState({ error: message });
  if (!project || project.id !== projectId) return null;
  return (
    <Row
      icon={<GitHubIcon size={16} className="text-text-secondary" />}
      label={name}
      trailing={remote ? <ExternalLink size={12} className="shrink-0 text-text-muted" aria-hidden="true" /> : <FolderOpen size={12} className="shrink-0 text-text-muted" aria-hidden="true" />}
      onClick={() => {
        const action = remote ? client.openExternalUrl(remote) : client.openPath(path);
        void action.catch((reason: unknown) => setStoreError(formatUnknownError(reason)));
      }}
    />
  );
}

const fallbackEditorIcons: Record<EditorId, typeof FolderOpen> = {
  finder: FolderOpen,
  terminal: SquareTerminal,
  cursor: MousePointer2,
  vscode: FileCode2,
  xcode: Hammer,
};

function EditorOpenSection({ sessionId, path, onClose }: { sessionId: string; path: string | null; onClose: () => void }) {
  const t = useTranslation();
  const editors = useAppStore((state) => state.editors);
  const editorIcons = useAppStore((state) => state.editorIcons);
  const loadEditors = useAppStore((state) => state.loadEditors);
  const setStoreError = (message: string) => useAppStore.setState({ error: message });
  useEffect(() => {
    void loadEditors();
  }, [loadEditors]);
  const installed = (editors ?? []).filter((editor) => editor.installed);
  return (
    <Expandable icon={<FolderOpen size={14} />} label={t("Open in…")}>
      {!editors ? (
        <p className="ui-caption text-text-muted">{t("common.loading")}</p>
      ) : installed.length === 0 ? (
        <p className="ui-caption text-text-muted">{t("No editors detected.")}</p>
      ) : (
        <div className="space-y-0.5">
          {installed.map((editor) => {
            const icon = editorIcons[editor.id];
            const Fallback = fallbackEditorIcons[editor.id];
            return (
              <button
                key={editor.id}
                type="button"
                className="flex w-full items-center gap-[8px] rounded-[8px] px-[8px] py-[4px] text-left ui-body text-text-secondary hover:bg-background-3 hover:text-text-primary"
                onClick={() => {
                  void client
                    .openInEditor(sessionId, editor.id, path)
                    .catch((reason: unknown) => setStoreError(formatUnknownError(reason)));
                  onClose();
                }}
              >
                <span className="flex size-[16px] shrink-0 items-center justify-center" aria-hidden="true">
                  {icon ? <img src={`data:image/png;base64,${icon}`} alt="" className="size-[16px]" /> : <Fallback size={15} />}
                </span>
                <span className="truncate">{editor.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </Expandable>
  );
}
