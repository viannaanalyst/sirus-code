import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpFromLine,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  Eye,
  FileCode2,
  FolderOpen,
  GitBranch,
  Download,
  GitCommitHorizontal,
  GitFork,
  GitPullRequest,
  GitCompareArrows,
  Globe,
  Hammer,
  Laptop,
  MessagesSquare,
  MousePointer2,
  Plus,
  Search,
  Settings2,
  Square,
  SquareTerminal,
  Trash2,
} from "@/components/icons/phosphor";
import { client } from "@/client";
import type { BranchInfo, EditorId } from "@/client/types";
import { GitHubIcon } from "@/components/icons/BrandIcons";
import { WindowIcon } from "@/components/icons/WindowIcon";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { orderedUsageWindows, resetDuration, usageWindowLabel } from "@/lib/provider-usage";
import { cn } from "@/lib/cn";
import { motionTokens } from "@/lib/motion";
import { CiFixRow } from "@/components/EnvironmentPullRequestSection";
import { PrWatchBadge, PrWatchPanel } from "@/components/PrWatch";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
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
      // An open row popover takes Escape first; the card stays.
      if (event.key === "Escape" && !document.querySelector("[data-environment-popover]")) setOpen(false);
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
  const showRepository = useAppStore((state) => state.settings.showEnvironmentRepository);
  const showEditor = useAppStore((state) => state.settings.showEnvironmentEditor);
  const ciFixActive = useAppStore((state) => state.settings.ciAutoFix && state.ciAutoFix.some((item) => item.sessionId === session?.id && (item.status === "fixing" || item.status === "paused")));
  const prWatch = useAppStore((state) => state.settings.prWatch);

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
        <LocalRow sessionId={session.id} onClose={onClose} />
        <BranchRow projectId={project.id} branch={session.worktree.branch} isolated={session.worktree.isolated} />
        <CommitAndPushSection sessionId={session.id} projectId={project.id} projectPath={project.path} isolated={session.worktree.isolated} onClose={onClose} />
        <LocalServersSection sessionId={session.id} />
        {/* CI auto-fix shows itself only while it is working or needs attention (ADR-064). */}
        {ciFixActive ? <CiFixRow sessionId={session.id} /> : null}
        {/* PR watch (ADR-079): the session's own pull request, never a side chat's. */}
        {prWatch && !session.sideChat ? <Expandable icon={<Eye size={14} />} label={t("prWatch.row")} heading={null} trailing={<PrWatchBadge sessionId={session.id} />}>
          <PrWatchPanel sessionId={session.id} />
        </Expandable> : null}
        <SideChatRow parentSessionId={session.id} onClose={onClose} />
        {showRepository && <><Divider />
        <Section title={t("Repository")}>
          <RepositoryRow projectId={project.id} name={project.name} path={project.path} />
        </Section></>}
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
  return <div className="my-[3px] border-t border-border-subtle" />;
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
  return <p className="px-[8px] pb-[2px] pt-[3px] ui-control text-text-muted">{children}</p>;
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
      className="flex w-full items-center gap-[8px] rounded-[8px] px-[8px] py-[3px] text-left ui-body text-text-secondary hover:bg-background-3 hover:text-text-primary"
    >
      <span className="shrink-0 text-text-muted [&_svg]:size-[16px]" aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

/** A row that opens its options in a popover below it (like Synara), so the card never grows. */
function Expandable({
  icon,
  label,
  heading,
  trailing,
  children,
  open: controlled,
  onOpenChange,
}: {
  icon: ReactNode;
  label: string;
  /** Small title inside the popover; omitted when the content brings its own. */
  heading?: string | null;
  trailing?: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [local, setLocal] = useState(false);
  const open = controlled ?? local;
  const setOpen = onOpenChange ?? setLocal;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          className={cn("flex w-full items-center gap-[8px] rounded-[8px] px-[8px] py-[3px] text-left ui-body text-text-secondary hover:bg-background-3 hover:text-text-primary", open && "bg-background-3 text-text-primary")}
        >
          <span className="shrink-0 text-text-muted [&_svg]:size-[16px]" aria-hidden="true">{icon}</span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {trailing}
          <ChevronDown size={12} aria-hidden="true" className={cn("shrink-0 text-text-muted opacity-60 transition-transform", open && "rotate-180")} />
        </button>
      </PopoverTrigger>
      <PopoverContent data-environment-popover="" side="bottom" align="end" sideOffset={4} collisionPadding={12} aria-label={label} className="w-[256px] p-1.5">
        {heading === null ? null : <p className="px-2 pb-1 pt-0.5 ui-caption text-text-muted">{heading ?? label}</p>}
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** One action line inside a row popover. */
function MenuItem({ icon, label, trailing, disabled, onClick }: { icon: ReactNode; label: string; trailing?: ReactNode; disabled?: boolean; onClick?: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick}
    className="flex w-full items-center gap-[8px] rounded-[7px] px-2 py-[5px] text-left ui-control text-text-secondary hover:bg-background-3 hover:text-text-primary disabled:pointer-events-none disabled:opacity-40">
    <span className="shrink-0 text-text-muted [&_svg]:size-[15px]" aria-hidden="true">{icon}</span>
    <span className="min-w-0 flex-1 truncate">{label}</span>
    {trailing}
  </button>;
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

function LocalRow({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const t = useTranslation();
  const session = useAppStore((state) => state.sessions.find((item) => item.id === sessionId));
  // The handoff recap ends at the last finished answer of the loaded transcript.
  const handoffFrom = useAppStore((state) => [...(state.sessions.find((item) => item.id === sessionId)?.messages ?? [])].reverse().find((message) => message.role === "agent" && !message.streaming && message.content.trim())?.id ?? null);
  const usage = useAppStore((state) => (session ? state.usageByProvider[session.agent] : undefined));
  const refreshUsage = useAppStore((state) => state.refreshProviderUsage);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const fail = (reason: unknown) => useAppStore.setState({ error: formatUnknownError(reason) });
  if (!session) return null;
  const windows = orderedUsageWindows(usage);
  const now = Date.now();
  return (
    <Expandable icon={<Laptop size={14} />} label={t(session.worktree.isolated ? "Isolated worktree" : "Local workspace")} heading={t("env.workIn")}>
      <MenuItem icon={<Laptop size={14} />} label={t(session.worktree.isolated ? "Isolated worktree" : "env.localProject")} trailing={<Check size={13} className="shrink-0 text-text-primary" aria-hidden="true" />} />
      <MenuItem icon={<GitFork size={14} />} label={t("env.handoffWorktree")} disabled={!handoffFrom || ["starting", "running", "waiting"].includes(session.status)}
        onClick={() => { if (handoffFrom) { onClose(); void useAppStore.getState().handoffSession(session.id, handoffFrom, session.agent, session.model ?? null, true); } }} />
      <MenuItem icon={<FolderOpen size={14} />} label={t("Open folder")} onClick={() => void client.openPath(session.worktree.path).catch(fail)} />
      <MenuItem icon={<Copy size={14} />} label={t("Copy path")} onClick={() => void navigator.clipboard.writeText(session.worktree.path)} />
      <div className="my-1 border-t border-border-subtle" />
      <MenuItem icon={<Clock3 size={14} />} label={t("env.rateLimits")}
        trailing={<ChevronDown size={12} aria-hidden="true" className={cn("shrink-0 text-text-muted transition-transform", limitsOpen && "rotate-180")} />}
        onClick={() => { const next = !limitsOpen; setLimitsOpen(next); if (next) void refreshUsage(session.agent); }} />
      {limitsOpen ? <div className="flex flex-col gap-2 px-2 pb-1.5 pt-1">
        {windows.length === 0 ? <p className="ui-caption text-text-muted">{t(usage ? "Usage unavailable" : "common.loading")}</p> : windows.map((window) => {
          const used = window.usedPercent ?? 0;
          const left = Math.max(0, Math.round(100 - used));
          const reset = window.resetsAt != null && window.resetsAt > now ? resetDuration(window.resetsAt, now) : null;
          return <div key={window.id}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate ui-control text-text-primary">{t(usageWindowLabel(window))}</span>
              <span className="shrink-0 ui-caption tabular-nums text-text-muted">{t("env.left", { percent: left })}</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)]" aria-hidden="true">
              <div className={cn("h-full rounded-full", used >= 90 ? "bg-danger" : used >= 70 ? "bg-warning" : "bg-success")} style={{ width: `${left}%` }} />
            </div>
            {reset ? <p className="mt-0.5 ui-caption text-text-muted">{t("env.resetsIn", { time: reset })}</p> : null}
          </div>;
        })}
      </div> : null}
    </Expandable>
  );
}

function BranchRow({ projectId, branch, isolated }: { projectId: string; branch: string; isolated: boolean }) {
  const t = useTranslation();
  const refreshGitStatus = useAppStore((state) => state.refreshGitStatus);
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const fail = (reason: unknown) => useAppStore.setState({ error: formatUnknownError(reason) });
  const load = () => { setBranches(null); void client.listBranches(projectId).then(setBranches).catch((reason: unknown) => { setBranches([]); fail(reason); }); };
  // An isolated worktree keeps its own branch; only the project checkout switches.
  const listed = isolated ? [{ name: branch, current: true }] : branches ?? [];
  const shown = listed.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()));
  const exact = shown.some((item) => item.name === query.trim());
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try { await task(); await refreshGitStatus(); setOpen(false); } catch (reason) { fail(reason); } finally { setBusy(false); }
  };
  return (
    <Expandable icon={<GitBranch size={14} />} label={branch} heading={null} open={open}
      onOpenChange={(next) => { setOpen(next); setQuery(""); setCreating(false); if (next && !isolated) load(); }}>
      <div className="mb-1 flex items-center gap-2 rounded-[8px] border border-[var(--field-focus-border)] px-2 py-1.5 text-text-muted">
        <Search size={13} aria-hidden="true" />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(creating ? "New branch name" : "Search branches…")}
          onKeyDown={(event) => { if (event.key === "Enter" && creating && query.trim()) void run(() => client.createBranch(projectId, query.trim())); }}
          className="w-full bg-transparent ui-control text-text-primary outline-none placeholder:text-text-muted" />
      </div>
      {!creating ? <div className="scroll-thin max-h-52 overflow-y-auto">
        {!isolated && branches === null ? <p className="px-2 py-1.5 ui-caption text-text-muted">{t("common.loading")}</p>
          : shown.map((item) => <MenuItem key={item.name} icon={<GitBranch size={14} />} label={item.name} disabled={busy || isolated || item.current}
            trailing={item.current ? <span className="shrink-0 ui-caption text-text-muted">{t("current")}</span> : undefined}
            onClick={() => void run(() => client.checkoutBranch(projectId, item.name))} />)}
      </div> : null}
      {isolated ? <p className="px-2 pb-1 pt-1 ui-caption text-text-muted">{t("env.isolatedBranch")}</p> : <>
        <div className="my-1 border-t border-border-subtle" />
        {creating
          ? <MenuItem icon={<Plus size={14} />} label={t("env.createNamed", { name: query.trim() || "…" })} disabled={busy || !query.trim() || exact} onClick={() => void run(() => client.createBranch(projectId, query.trim()))} />
          : <MenuItem icon={<Plus size={14} />} label={t("env.createBranch")} disabled={busy} onClick={() => { setCreating(true); setQuery(""); }} />}
      </>}
    </Expandable>
  );
}

type GitStep = "menu" | "commit" | "commitPush" | "push" | "pull" | "pr" | "branch";

function CommitAndPushSection({ sessionId, projectId, projectPath, isolated, onClose }: { sessionId: string; projectId: string; projectPath: string; isolated: boolean; onClose: () => void }) {
  const t = useTranslation();
  const isRepo = useAppStore((state) => state.gitByPath[projectPath]?.isRepo ?? state.gitStatus?.identity.isRepo ?? false);
  const ahead = useAppStore((state) => state.gitStatus?.ahead ?? 0);
  const refreshGitStatus = useAppStore((state) => state.refreshGitStatus);
  const openDockPane = useAppStore((state) => state.openDockPane);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<GitStep>("menu");
  const [message, setMessage] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ error: boolean; text: string; url?: string } | null>(null);

  if (!isRepo) return null;

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      if (step === "pull") {
        const pulled = await client.gitPull(sessionId);
        setResult({ error: false, text: pulled.summary || t("env.pulled", { branch: pulled.branch }) });
      } else if (step === "pr") {
        const url = await client.createPullRequest(sessionId, message, body, draft);
        setMessage("");
        setBody("");
        setDraft(false);
        setResult({ error: false, text: t("env.prCreated"), url });
      } else if (step === "branch") {
        await client.createBranch(projectId, message.trim());
        setMessage("");
        setResult({ error: false, text: t("env.branchCreated") });
      } else {
        if (step !== "push") {
          const committed = await client.gitCommit(sessionId, message);
          setMessage("");
          setResult({ error: false, text: committed.summary || committed.hash.slice(0, 8) });
        }
        if (step !== "commit") {
          const pushed = await client.gitPush(sessionId);
          setResult({ error: false, text: t("Pushed {branch}", { branch: pushed.branch }) });
        }
      }
      setStep("menu");
      await refreshGitStatus();
    } catch (reason) {
      setResult({ error: true, text: formatUnknownError(reason) });
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<GitStep, string> = { menu: "env.gitActions", commit: "Commit", commitPush: "Commit and Push", push: "Push", pull: "env.pull", pr: "env.createPr", branch: "env.newBranch" };
  const confirmLabels: Record<GitStep, string> = { menu: "", commit: "Commit", commitPush: "Commit and Push", push: "Confirm push", pull: "env.confirmPull", pr: "env.createPr", branch: "Create" };
  const needsText = step === "commit" || step === "commitPush" || step === "pr" || step === "branch";
  const field = "w-full rounded-[7px] border border-border-subtle bg-[var(--surface)] px-2 py-1.5 ui-control text-text-primary placeholder:text-text-muted focus-visible:border-[var(--field-focus-border)] focus-visible:outline-none";
  const go = (next: GitStep) => { setResult(null); setMessage(""); setStep(next); };
  return (
    <Expandable
      icon={<ArrowUpFromLine size={14} />}
      label={t("Commit and Push")}
      heading={t(titles[step])}
      open={open}
      onOpenChange={(next) => { setOpen(next); if (!next) { setStep("menu"); setResult(null); } }}
      trailing={ahead > 0 ? <span className="ui-caption text-text-muted">{t("{count} ahead", { count: ahead })}</span> : undefined}
    >
      {step === "menu" ? <>
        <MenuItem icon={<GitCommitHorizontal size={14} />} label={t("Commit")} onClick={() => go("commit")} />
        <MenuItem icon={<Download size={14} />} label={t("env.pull")} onClick={() => go("pull")} />
        <MenuItem icon={<ArrowUpFromLine size={14} />} label={t("Commit and Push")} onClick={() => go("commitPush")} />
        <MenuItem icon={<ArrowUpFromLine size={14} />} label={t("Push")} trailing={ahead > 0 ? <span className="ui-caption text-text-muted">{ahead}</span> : undefined} onClick={() => go("push")} />
        <MenuItem icon={<GitPullRequest size={14} />} label={t("env.createPr")} onClick={() => go("pr")} />
        <MenuItem icon={<GitBranch size={14} />} label={t("env.newBranch")} disabled={isolated} onClick={() => go("branch")} />
        <div className="my-1 border-t border-border-subtle" />
        <MenuItem icon={<GitCompareArrows size={14} />} label={t("env.reviewChanges")} onClick={() => { openDockPane("changes"); setOpen(false); onClose(); }} />
      </> : <div className="flex flex-col gap-1.5 px-1 pb-1">
        {step === "branch" || step === "pr"
          ? <input autoFocus value={message} onChange={(event) => setMessage(event.target.value)} placeholder={t(step === "pr" ? "env.prTitle" : "New branch name")} className={field} />
          : step === "commit" || step === "commitPush"
            ? <textarea autoFocus value={message} onChange={(event) => setMessage(event.target.value)} placeholder={t("Commit message")} rows={2} className={cn(field, "resize-none")} />
            : <p className="px-1 ui-caption text-text-muted">{t(step === "pull" ? "env.pullHint" : "env.pushHint")}</p>}
        {step === "pr" ? <>
          <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder={t("env.prBody")} rows={3} className={cn(field, "resize-none")} />
          <label className="flex items-center gap-2 px-1 ui-caption text-text-secondary"><input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} />{t("env.prDraft")}</label>
          <p className="px-1 ui-caption text-text-muted">{t("env.prHint")}</p>
        </> : null}
        <div className="flex items-center justify-end gap-1">
          <InteractiveButton variant="toolbar" disabled={busy} onClick={() => setStep("menu")}>{t("common.cancel")}</InteractiveButton>
          <InteractiveButton variant="toolbar" disabled={busy || (needsText && !message.trim())} onClick={() => void run()}>
            {busy ? t("common.loading") : t(confirmLabels[step])}
          </InteractiveButton>
        </div>
      </div>}
      {result ? <p role={result.error ? "alert" : "status"} className={cn("break-words px-2 pb-1 pt-1 ui-caption", result.error ? "text-danger" : "text-text-muted")}>
        {t(result.text)}
        {result.url ? <> · <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => void client.openExternalUrl(result.url!).catch(() => undefined)}>{t("env.openPr")}</button></> : null}
      </p> : null}
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
    <button type="button" onClick={open} className="flex min-w-0 flex-1 items-center gap-[8px] px-[8px] py-[3px] text-left ui-body text-text-secondary hover:text-text-primary">
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
  const fail = (reason: unknown) => useAppStore.setState({ error: formatUnknownError(reason) });
  return (
    <Expandable
      icon={<Globe size={14} />}
      label={t("Local Servers")}
      heading={servers.length ? t("env.serversRunning", { count: servers.length }) : t("Local Servers")}
      trailing={servers.length ? <span className="mr-1 flex items-center gap-1.5 ui-caption tabular-nums text-text-muted"><span className="size-1.5 rounded-full bg-success shadow-[0_0_6px_var(--success)]" aria-hidden="true" />{servers.length}</span> : undefined}
    >
      {servers.length === 0 ? <p className="px-2 pb-1 ui-caption text-text-muted">{t("No local servers detected.")}</p> : servers.map((url) => {
        let host = url;
        let path = "";
        try { const parsed = new URL(url); host = parsed.host; path = parsed.pathname === "/" ? "" : parsed.pathname; } catch { /* keep the raw URL */ }
        return <div key={url} className="group flex w-full items-center gap-1 rounded-[7px] hover:bg-background-3">
          <button type="button" title={url} className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left"
            onClick={() => void client.openExternalUrl(url).catch(fail)}>
            <span className="size-1.5 shrink-0 rounded-full bg-success shadow-[0_0_6px_var(--success)]" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate ui-control text-text-primary">{host}</span>
              {path ? <span className="block truncate font-mono ui-micro text-text-muted">{path}</span> : null}
            </span>
          </button>
          <button type="button" aria-label={t("env.stopServer")} title={t("env.stopServer")}
            className="mr-1.5 grid size-5 shrink-0 place-items-center rounded-[5px] text-text-muted hover:bg-background-3 hover:text-danger"
            onClick={() => void client.stopLocalServer(sessionId, url).then(() => useAppStore.setState((state) => ({ localServersBySession: { ...state.localServersBySession, [sessionId]: (state.localServersBySession[sessionId] ?? []).filter((item) => item !== url) } }))).catch(fail)}>
            <Square size={10} aria-hidden="true" />
          </button>
        </div>;
      })}
    </Expandable>
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
                className="flex w-full items-center gap-[8px] rounded-[8px] px-[8px] py-[3px] text-left ui-body text-text-secondary hover:bg-background-3 hover:text-text-primary"
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
