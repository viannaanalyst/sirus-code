import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { useSidebarPanelHold } from "@/components/SidebarPanelHold";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Archive, ArchiveRestore, CircleCheck, GitBranch, GitCompareArrows, MessageCircle, Pin, PinOff, Settings, SquarePen, Terminal, Undo2, Zap } from "@/components/icons/phosphor";
import { Folder as FolderGlyph, FolderOpen as FolderOpenGlyph } from "@phosphor-icons/react";
import type { AppSettings, Project, Session } from "@/client/types";
import { ModelIcon } from "@/components/ModelIcon";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { ProjectActions } from "@/components/ProjectActions";
import { ProjectGlyph } from "@/components/ProjectGlyph";
import { ProjectLookEditor } from "@/components/ProjectLookEditor";
import { ProjectScriptsFields } from "@/components/ProjectScriptsFields";
import { SessionActions } from "@/components/SessionActions";
import { SidebarHoverCard } from "@/components/SidebarHoverCard";
import { StatusIndicator } from "@/primitives/StatusIndicator";
import { Tooltip } from "@/primitives/Tooltip";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Input } from "@/components/arc/input/input";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { useTranslation } from "@/i18n/use-translation";
import { beginSplitDrag } from "@/lib/split-drag";
import { useAppStore } from "@/store/app-store";
import { archiveSidebarSession, toggleSessionDone, toggleSidebarId } from "@/lib/sidebar-layout";
import { sidebarProjectAction } from "@/lib/sidebar-actions";
import { modelDisplayName } from "@/lib/model-registry";
import { relativeTime } from "@/lib/session-board";
import { providerById } from "@/lib/provider-registry";
import { cn } from "@/lib/cn";

/** Exact Synara folder glyphs, painted as one mask rather than overlapping strokes. */
function SidebarFolder({ expanded = false }: { expanded?: boolean }) {
  const Glyph = expanded ? FolderOpenGlyph : FolderGlyph;
  return <Glyph aria-hidden="true" className="sidebar-folder-glyph" size={15} />;
}

function RowAction({ label, children, onClick, pressed, className, disabled }: { label: string; children: ReactNode; onClick: () => void; pressed?: boolean; className?: string; disabled?: boolean }) {
  return <Tooltip label={label}><button type="button" className={cn("sidebar-row-action", className)} disabled={disabled} aria-label={label} aria-pressed={pressed} onClick={(event) => { event.stopPropagation(); onClick(); }}>{children}</button></Tooltip>;
}

export function SidebarProjectRow({ project, expanded, onSelect, sessionCount, reorderProps }: { project: Project; expanded: boolean; onSelect: () => void; sessionCount: number; reorderProps?: ButtonHTMLAttributes<HTMLButtonElement> }) {
  const t = useTranslation();
  const pinned = useAppStore((state) => state.settings.pinnedProjectIds.includes(project.id));
  const [editing, setEditing] = useState(false);
  useSidebarPanelHold(editing);
  const [name, setName] = useState(project.name);
  const [scripts, setScripts] = useState({ setup: "", onFinish: "" });
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const togglePin = () => { const state = useAppStore.getState(); void state.saveSettings({ ...state.settings, pinnedProjectIds: toggleSidebarId(state.settings.pinnedProjectIds, project.id) }); };
  const action = (kind: "new" | "terminal" | "review") => {
    if (actionBusy) return;
    setActionBusy(true);
    void sidebarProjectAction(project.id, kind).finally(() => setActionBusy(false));
  };
  const openEditor = () => { setName(project.name); setScripts({ setup: project.scripts?.setup ?? "", onFinish: project.scripts?.onFinish ?? "" }); setEditing(true); };
  const save = async () => {
    const store = useAppStore.getState();
    if (!await store.renameProject(project.id, name)) return false;
    const changed = scripts.setup.trim() !== (project.scripts?.setup ?? "") || scripts.onFinish.trim() !== (project.scripts?.onFinish ?? "");
    return !changed || store.saveProjectScripts(project.id, scripts.setup, scripts.onFinish);
  };
  const folder = <ProjectGlyph project={project} expanded={expanded} />;
  const pinLabel = t(pinned ? "Unpin project" : "Pin project");
  return <>
    <SidebarHoverCard label={project.name} content={<>
      <div className="sidebar-card-line sidebar-card-title ui-control"><ProjectGlyph project={project} expanded /><strong>{project.name}</strong><RowAction label={pinLabel} pressed={pinned} onClick={togglePin}><Pin fill={pinned ? "currentColor" : "none"} /></RowAction></div>
      <div className="sidebar-card-line ui-control"><MessageCircle /><span>{t("{count} sessions", { count: sessionCount })}</span></div>
      <div className="sidebar-card-separator" />
      <div className="sidebar-card-line ui-caption"><SidebarFolder /><span className="sidebar-card-path" title={project.path}>{project.path}</span></div>
      <div className="sidebar-card-separator" />
      <button className="sidebar-card-line sidebar-card-edit ui-control" type="button" onClick={openEditor}><Settings />{t("Edit project")}</button>
    </>}>
      <ProjectActions project={project} onEdit={openEditor}><div className={cn("sidebar-project-row", pinned && "sidebar-project-pinned")}>
        <button {...reorderProps} type="button" className="sidebar-project-open ui-body" aria-expanded={expanded} onClick={onSelect}><span className="sidebar-folder-slot">{folder}</span><span className="sidebar-row-title">{project.name}</span></button>
        <RowAction label={pinLabel} pressed={pinned} className="sidebar-project-pin" onClick={togglePin}><Pin fill={pinned ? "currentColor" : "none"} /></RowAction>
        <span className="sidebar-hover-actions sidebar-project-actions"><RowAction label={t("Review changes")} disabled={actionBusy} onClick={() => action("review")}><GitCompareArrows /></RowAction><RowAction label={t("New terminal session")} disabled={actionBusy} onClick={() => action("terminal")}><Terminal /></RowAction><RowAction label={t("New thread")} className="sidebar-new-thread-action" disabled={actionBusy} onClick={() => action("new")}><SquarePen /></RowAction></span>
      </div></ProjectActions>
    </SidebarHoverCard>
    <Dialog open={editing} onOpenChange={(open) => { if (!busy) setEditing(open); }}><DialogContent title={t("Edit project")} description={t("projectLook.dialogHelp")} className="w-[min(460px,calc(100vw-32px))]">
      <form onSubmit={(event) => { event.preventDefault(); if (busy) return; setBusy(true); void save().then((saved) => { if (saved) setEditing(false); }).finally(() => setBusy(false)); }}>
        <div className="mt-4"><Input label={t("Project name")} autoFocus required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></div>
        <ProjectLookEditor projectId={project.id} />
        <ProjectScriptsFields setup={scripts.setup} onFinish={scripts.onFinish} disabled={busy} onChange={setScripts} />
        <div className="mt-5 flex justify-end gap-2"><InteractiveButton variant="ghost" disabled={busy} onClick={() => setEditing(false)}>{t("common.cancel")}</InteractiveButton><InteractiveButton type="submit" loading={busy} disabled={!name.trim()}>{t("common.save")}</InteractiveButton></div>
      </form>
    </DialogContent></Dialog>
  </>;
}

/** `showProject` and `unseen` serve the cross-project Activity view. */
export function SidebarSessionRow({ session, project, active, archived = false, showProject = false, unseen = false }: { session: Session; project?: Project; active: boolean; archived?: boolean; showProject?: boolean; unseen?: boolean }) {
  const t = useTranslation();
  const temporary = useAppStore((state) => state.temporarySessionIds.includes(session.id));
  const pinned = useAppStore((state) => state.settings.pinnedSessionIds.includes(session.id));
  const togglePin = () => { const state = useAppStore.getState(); void state.saveSettings({ ...state.settings, pinnedSessionIds: toggleSidebarId(state.settings.pinnedSessionIds, session.id) }); };
  const toggleArchive = () => { const state = useAppStore.getState(); if (archived) void state.saveSettings(archiveSidebarSession(state.settings, session.id)); else state.requestArchive(session.id); };
  return <SidebarHoverCard label={session.title} content={<SessionHoverContent session={session} project={project} />}>
    <SessionActions session={session}><div className={cn("sidebar-session-row", active && "sidebar-session-selected")}>
      <button type="button" className="sidebar-session-open ui-body" aria-current={active ? "page" : undefined} aria-label={`${session.title} · ${t(`status.${session.status}`)}`} onPointerDown={(event) => beginSplitDrag(event, session.id, session.title)} onClick={() => void useAppStore.getState().selectSession(session.id)}>
        <span className={cn("sidebar-session-brand", session.handoff && "sidebar-session-handoff")}>{session.handoff && <span className="sidebar-handoff-source"><ProviderIcon id={session.handoff.from} size={8} /></span>}<ModelIcon modelId={session.model ?? ""} provider={session.agent} size={12} /></span>
        <span className="sidebar-row-title">{session.title}</span>
        {temporary && <span className="sidebar-session-temporary" role="img" aria-label={t("temporary.badge")} title={t("temporary.badge")}><MessageCircle size={11} /></span>}
        {showProject && project && <span className="sidebar-session-project ui-caption">{project.name}</span>}
        {unseen && !active && <span className="sidebar-session-unseen" role="img" aria-label={t("activity.unread")} />}
        {["starting", "running", "waiting", "failed"].includes(session.status) && <span className="sidebar-session-meta"><StatusIndicator status={session.status} /></span>}
      </button>
      <span className="sidebar-hover-actions sidebar-session-actions">{!archived && <RowAction label={t(pinned ? "Unpin session" : "Pin session")} pressed={pinned} onClick={togglePin}>{pinned ? <PinOff /> : <Pin />}</RowAction>}<RowAction label={t(archived ? "Restore session" : "Archive session")} onClick={toggleArchive}>{archived ? <ArchiveRestore /> : <Archive />}</RowAction></span>
    </div></SessionActions>
  </SidebarHoverCard>;
}

/** Hover details shared by session rows: title and age, project, branch, workspace, model and live status. */
function SessionHoverContent({ session, project }: { session: Session; project?: Project }) {
  const t = useTranslation();
  const catalog = useAppStore((state) => state.modelsByProvider[session.agent]);
  const rawModel = catalog?.models.find((row) => row.id === session.model)?.displayName ?? session.model;
  const modelLabel = rawModel ? modelDisplayName(session.agent, rawModel, catalog?.models.map((row) => row.displayName)) : providerById(session.agent).name;
  const time = relativeTime(session.lastActivityAt);
  return <>
    <div className="sidebar-card-line sidebar-card-title ui-control"><strong>{session.title}</strong><span className="ui-micro text-text-muted">{time === "now" ? t("Now") : time}</span></div>
    {project && <div className="sidebar-card-line ui-control"><SidebarFolder /><span>{project.name}</span></div>}
    {session.worktree.branch && <div className="sidebar-card-line ui-control"><GitBranch /><span>{session.worktree.branch}</span></div>}
    {session.worktree.isolated && <div className="sidebar-card-line ui-caption"><GitCompareArrows /><span>{t("workspace.isolated")}</span></div>}
    <div className="sidebar-card-line sidebar-card-model ui-control"><ModelIcon modelId={session.model ?? ""} provider={session.agent} size={14} /><span>{modelLabel}</span>{session.execution?.fast && <Zap aria-label={t("composer.fast")} />}{session.execution?.effort && <span className="ui-caption text-text-muted">{t(`effort.${session.execution.effort}`)}</span>}</div>
    {["starting", "running", "waiting", "failed"].includes(session.status) && <div className="sidebar-card-line ui-caption"><StatusIndicator status={session.status} /><span>{t(`status.${session.status}`)}</span></div>}
  </>;
}

/**
 * Activity view row (Synara layout): model mark and title, then the project
 * folder and branch. Hover offers pin, archive and Done; Done rows are dimmed
 * and offer Undo. Newer activity reopens a Done session on its own.
 */
export function SidebarActivityRow({ session, project, active, done, unseen = false }: { session: Session; project?: Project; active: boolean; done: boolean; unseen?: boolean }) {
  const t = useTranslation();
  const pinned = useAppStore((state) => state.settings.pinnedSessionIds.includes(session.id));
  const temporary = useAppStore((state) => state.temporarySessionIds.includes(session.id));
  const save = (update: (settings: AppSettings) => AppSettings) => { const state = useAppStore.getState(); void state.saveSettings(update(state.settings)); };
  const toggleDone = () => {
    if (!done) useAppStore.setState((state) => ({ unseenSessionIds: state.unseenSessionIds.filter((id) => id !== session.id) }));
    save((settings) => toggleSessionDone(settings, session.id, done ? null : new Date()));
  };
  const live = ["starting", "running", "waiting", "failed"].includes(session.status);
  return <SidebarHoverCard label={session.title} content={<SessionHoverContent session={session} project={project} />}>
    <SessionActions session={session}><div className={cn("sidebar-session-row sidebar-activity-row", active && "sidebar-session-selected", done && "sidebar-activity-done")}>
      <button type="button" className="sidebar-activity-open ui-body" aria-current={active ? "page" : undefined} aria-label={`${session.title} · ${project?.name ?? ""} · ${t(`status.${session.status}`)}`}
        onPointerDown={(event) => beginSplitDrag(event, session.id, session.title)} onClick={() => void useAppStore.getState().selectSession(session.id)}>
        <span className="sidebar-activity-line">
          <span className={cn("sidebar-session-brand", session.handoff && "sidebar-session-handoff")}>{session.handoff && <span className="sidebar-handoff-source"><ProviderIcon id={session.handoff.from} size={8} /></span>}<ModelIcon modelId={session.model ?? ""} provider={session.agent} size={12} /></span>
          <span className="sidebar-row-title">{session.title}</span>
          {temporary && <span className="sidebar-session-temporary" role="img" aria-label={t("temporary.badge")} title={t("temporary.badge")}><MessageCircle size={11} /></span>}
        </span>
        <span className="sidebar-activity-meta ui-caption">
          <span className="sidebar-activity-project">{project ? <ProjectGlyph project={project} size={13} /> : <FolderGlyph aria-hidden="true" size={13} />}<span className="truncate">{project?.name ?? ""}</span>{session.worktree.isolated ? <GitCompareArrows aria-hidden="true" size={12} /> : null}</span>
          {session.worktree.branch && session.worktree.branch !== "unknown" ? <span className="sidebar-activity-branch"><GitBranch aria-hidden="true" size={12} /><span className="truncate">{session.worktree.branch}</span></span> : null}
        </span>
      </button>
      {(live || (unseen && !active)) && <span className="sidebar-activity-status">{live ? <StatusIndicator status={session.status} /> : <span className="sidebar-session-unseen" role="img" aria-label={t("activity.unread")} />}</span>}
      <span className="sidebar-hover-actions sidebar-activity-actions">
        <RowAction label={t(pinned ? "Unpin session" : "Pin session")} pressed={pinned} onClick={() => save((settings) => ({ ...settings, pinnedSessionIds: toggleSidebarId(settings.pinnedSessionIds, session.id) }))}>{pinned ? <PinOff /> : <Pin />}</RowAction>
        <RowAction label={t("Archive session")} onClick={() => useAppStore.getState().requestArchive(session.id)}><Archive /></RowAction>
        <RowAction label={t(done ? "activity.undoDone" : "activity.markDone")} onClick={toggleDone}>{done ? <Undo2 /> : <CircleCheck />}</RowAction>
      </span>
    </div></SessionActions>
  </SidebarHoverCard>;
}

/** The Chat behavior archive confirmation, mounted once beside the sidebar. */
export function ArchiveConfirm() {
  const t = useTranslation();
  const pending = useAppStore((state) => state.archivePrompt);
  return <ConfirmDialog open={pending !== null} onOpenChange={(open) => { if (!open) useAppStore.setState({ archivePrompt: null }); }}
    title={t("chatBehavior.archiveTitle")} description={t("chatBehavior.archiveBody")} confirmLabel={t("chatBehavior.archive")} cancelLabel={t("common.cancel")} destructive={false}
    onConfirm={() => { if (pending) useAppStore.getState().requestArchive(pending, true); }} />;
}
