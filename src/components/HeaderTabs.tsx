import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Archive, Check, ChevronDown, ChevronRight, Clock3, Folder, FolderOutput, FolderPlus, GitCompareArrows, Moon, Pencil, Pin, PinOff, Plus, Search, SquarePen, SquareTerminal, Trash2, X, XCircle, ArrowRight, RotateCcw, Undo2 } from "@/components/icons/phosphor";
import type { Project, ProjectFolder, Session } from "@/client/types";
import { ProjectActions } from "@/components/ProjectActions";
import { ComputerBadge, SwitcherElsewhereProjects, SwitcherRemoteSessions, memberKey, useMergedComputers } from "@/components/ComputerSwitcher";
import { useMoveMenu } from "@/components/MoveSessionDialog";
import { SessionActionDialog } from "@/components/SessionActions";
import { SnoozeCountdown, SnoozePicker } from "@/components/SnoozePicker";
import { canSnooze, snoozeDeadline } from "@/lib/snooze";
import { ProjectEditDialog } from "@/components/SidebarRows";
import { relativeTime } from "@/lib/session-board";
import { holdSessionOrder, moveSidebarProject, sessionOrderSignature, sessionSortKeys, sidebarGroups, toggleSidebarId, type SessionOrderSnapshot } from "@/lib/sidebar-layout";
import { sidebarProjectAction } from "@/lib/sidebar-actions";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { ProjectGlyph } from "@/components/ProjectGlyph";
import { ProjectFolderDialog } from "@/components/ProjectFolderDialog";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { deleteFolder, folderOf, moveProjectToFolder, switcherEntries, updateFolder, visibleProjects } from "@/lib/project-folders";
import { ContextMenu } from "@/components/arc/context-menu/context-menu";
import { useTranslation } from "@/i18n/use-translation";
import { projectStatus, tabStatus, visibleTabSessions, VISIBLE_TABS, type TabStatus } from "@/lib/header-tabs";
import { isColumnSidebar } from "@/lib/conversation-list";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/primitives/Dropdown";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { selectCurrentProject, useAppStore, selectListedSessions, selectSnoozedSessions } from "@/store/app-store";
import { usePointerReorder } from "@/lib/use-pointer-reorder";
import { cascadeIndex, useCascade } from "@/lib/cascade";
import "@/styles/header-tabs.css";

/** Narrowest tab that still shows a readable title (px). */
const TAB_MIN_READABLE = 128;

/** Long titles scroll on hover (there and back) instead of being cut off; short ones stay still. */
function measureMarquee(event: ReactMouseEvent<HTMLElement>) {
  const outer = event.currentTarget, inner = outer.firstElementChild as HTMLElement | null;
  const overflow = inner ? inner.scrollWidth - outer.clientWidth : 0;
  outer.toggleAttribute("data-overflow", overflow > 2);
  outer.style.setProperty("--marquee-distance", `${-Math.max(0, overflow + 6)}px`);
  // About 60 px/s while moving; the keyframes spend 38% of the cycle travelling each way.
  outer.style.setProperty("--marquee-duration", `${Math.max(2.4, (overflow + 6) / 60 / 0.38)}s`);
}

/**
 * A session's mark in its tab: the provider while idle, three dots hopping
 * while the agent works, a green check when it finished unseen and an amber dot when it
 * needs the person.
 */
function TabGlyph({ agent, status, label }: { agent: Session["agent"]; status: TabStatus; label?: string }) {
  const a11y = { role: label ? "img" : undefined, "aria-label": label, "aria-hidden": label ? undefined : true } as const;
  if (status === "running") return <span className="header-tab-glyph header-tab-dots" {...a11y}><i /><i /><i /></span>;
  if (status === "done") return <span className="header-tab-glyph header-tab-done" {...a11y}><Check size={12} strokeWidth={2.4} aria-hidden="true" /></span>;
  if (status === "waiting") return <span className="header-tab-glyph" {...a11y}><span className="header-tab-status" data-status="waiting" /></span>;
  return <ProviderIcon id={agent} size={13} className="rounded-none bg-transparent" />;
}

function StatusDot({ status, label }: { status: TabStatus; label?: string }) {
  return status === "idle" ? null : <span className="header-tab-status" data-status={status} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

/** "Snooze…" for a session's menus (ADR-103); running or waiting ones say why they cannot. */
function snoozeItem(t: (key: string) => string, session: Session, onSelect: () => void, group?: string) {
  const allowed = canSnooze(session);
  return { id: "snooze", label: t("snooze.menu"), icon: <Moon size={15} />, group, disabled: !allowed, hint: allowed ? undefined : t("snooze.activeHint"), onSelect };
}

/** The element a menu's session row or tab occupies, so the snooze picker opens beside it. */
function sessionAnchor(selector: string) {
  return document.querySelector<HTMLElement>(selector);
}

/**
 * A small terminal glyph on a session whose terminal shell is running (ADR-121). Clicking it
 * selects the session and brings that terminal into view in the dock instead of starting another.
 */
function TerminalBadge({ sessionId, count, inTab = false, onReveal }: { sessionId: string; count: number; inTab?: boolean; onReveal?: () => void }) {
  const t = useTranslation();
  if (!count) return null;
  const label = count === 1 ? t("tabs.terminalRunning") : t("tabs.terminalsRunning", { count });
  return <button type="button" className="header-terminal-badge" data-no-reorder="" tabIndex={inTab ? -1 : undefined} aria-label={label} title={label}
    onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
    onClick={event => { event.preventDefault(); event.stopPropagation(); onReveal?.(); useAppStore.getState().revealTerminal(sessionId); }}>
    <SquareTerminal size={12} aria-hidden="true" />
  </button>;
}

function useWaitingSets() {
  const unseen = useAppStore(state => state.unseenSessionIds);
  const requests = useAppStore(state => state.computer?.requests);
  return useMemo(() => ({ unseen: new Set(unseen), computer: new Set((requests ?? []).map(request => request.sessionId)) }), [unseen, requests]);
}

/**
 * Project title in the header (ADR-092). It opens the switcher that replaced the sidebar:
 * projects on the left with live status and changes, and on the right every session of
 * the project under the pointer (pinned first), with New session, pin and archive. The
 * search matches project names and session titles; right-click a project for its actions.
 * The Project sidebar style (ADR-139, round 2) shows it at the top of the sidebar instead,
 * where it opens on click or ⌘⇧P only, since the pointer crosses the sidebar all the time.
 */
export function ProjectSwitcher({ placement = "header" }: { placement?: "header" | "sidebar" }) {
  const t = useTranslation();
  const project = useAppStore(selectCurrentProject);
  const projects = useAppStore(state => state.projects);
  const sessions = useAppStore(selectListedSessions);
  const snoozed = useAppStore(selectSnoozedSessions);
  const settings = useAppStore(state => state.settings);
  const currentDiff = useAppStore(state => project ? state.projectDiffs[project.id] : undefined);
  const open = useAppStore(state => state.projectSwitcherOpen);
  const setOpen = useAppStore(state => state.setProjectSwitcherOpen);
  const { unseen, computer } = useWaitingSets();
  const runningTerminals = useAppStore(state => state.runningTerminals);
  const moveItems = useMoveMenu();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [sessionAction, setSessionAction] = useState<{ session: Session; kind: "rename" | "delete" } | null>(null);
  const [snoozing, setSnoozing] = useState<{ session: Session; anchor: HTMLElement } | null>(null);
  const [snoozedOpen, setSnoozedOpen] = useState(true);
  const [folderDialog, setFolderDialog] = useState<{ folder?: ProjectFolder; projectId?: string } | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<ProjectFolder | null>(null);
  const list = useRef<HTMLDivElement>(null);
  // Hovering the project title opens the switcher (after a short pause, so passing over it
  // does not). Opened that way, it closes again when the pointer leaves both, unless the
  // person used it (typed, clicked or opened a menu), which keeps it until a click outside.
  const hover = useRef({ opened: false, used: false, at: 0, timer: 0 });
  const later = (action: () => void, delay: number) => { window.clearTimeout(hover.current.timer); hover.current.timer = window.setTimeout(action, delay); };
  const hoverIn = () => { if (open) { window.clearTimeout(hover.current.timer); return; } later(() => { hover.current = { ...hover.current, opened: true, used: false, at: Date.now() }; setOpen(true); }, 140); };
  const hoverOut = () => {
    if (!open) { window.clearTimeout(hover.current.timer); return; }
    if (hover.current.opened && !hover.current.used) later(() => { setOpen(false); setQuery(""); setFocus(null); }, 280);
  };
  const used = () => { hover.current.used = true; window.clearTimeout(hover.current.timer); };
  useEffect(() => () => window.clearTimeout(hover.current.timer), []);
  // Opened another way (click, shortcut, palette): it behaves as before.
  useEffect(() => { if (open && Date.now() - hover.current.at > 100) hover.current.opened = false; }, [open]);
  // Projects reorder by dragging, as they did in the sidebar (pinned and unpinned apart).
  const reorder = usePointerReorder({
    canDrop: (source, target) => target.startsWith("folder:") || settings.pinnedProjectIds.includes(source) === settings.pinnedProjectIds.includes(target),
    onDrop: (source, target, edge) => {
      const state = useAppStore.getState();
      // Dropped on a folder: into it. Beside a project: into that project's folder (or out), in its place.
      if (target.startsWith("folder:")) { void state.saveSettings(moveProjectToFolder(state.settings, source, target.slice(7))); return; }
      let next = moveSidebarProject(state.projects, state.settings, source, target, edge, state.sessions);
      const into = folderOf(state.settings, target)?.id ?? null;
      if ((folderOf(next, source)?.id ?? null) !== into) next = moveProjectToFolder(next, source, into);
      if (next !== state.settings) void state.saveSettings(next);
    },
  });
  const needle = query.trim().toLocaleLowerCase();
  // Rows cascade in when the switcher opens (ADR-096); filtered results while typing just appear.
  const cascade = useCascade(open) && !needle;
  // While the pointer is over the switcher the session order holds still, so a row never moves
  // between aiming at it and clicking it; the new order applies when the pointer leaves (ADR-121).
  const [hovering, setHovering] = useState(false);
  const liveOrder = useMemo<SessionOrderSnapshot>(() => ({ signature: sessionOrderSignature(settings), keys: sessionSortKeys(sessions, settings, { unseen, computer }) }), [sessions, settings, unseen, computer]);
  const [heldOrder, setHeldOrder] = useState(liveOrder);
  const order = holdSessionOrder(heldOrder, liveOrder, open && hovering);
  if (order !== heldOrder) setHeldOrder(order);
  const groups = useMemo(() => sidebarGroups(projects, sessions, settings, { unseen, computer, held: order.keys }), [projects, sessions, settings, unseen, computer, order]);
  const ordered = useMemo(() => [...groups.pinned, ...groups.nested], [groups]);
  const titleMatch = (session: Session) => !needle || session.title.toLocaleLowerCase().includes(needle);
  const rows = useMemo(() => groups.projects.filter(row => !needle || row.name.toLocaleLowerCase().includes(needle)
    || ordered.some(session => session.projectId === row.id && session.title.toLocaleLowerCase().includes(needle))), [groups.projects, ordered, needle]);
  const entries = useMemo(() => switcherEntries(rows, settings.projectFolders, Boolean(needle)), [rows, settings.projectFolders, needle]);
  // Keyboard moves through the projects that are showing (not those in a closed folder).
  const navRows = useMemo(() => visibleProjects(entries), [entries]);
  const focused = rows.find(row => row.id === focus) ?? rows.find(row => row.id === project?.id) ?? rows[0] ?? null;
  // Other computers' projects join this list (ADR-133 addendum); one only there can take the focus.
  const merged = useMergedComputers(projects);
  const [remoteFocus, setRemoteFocus] = useState<string | null>(null);
  const remoteMember = remoteFocus ? merged.elsewhere.find(member => memberKey(member) === remoteFocus) ?? null : null;
  const alsoHere = focused ? merged.alsoOn[focused.id] ?? [] : [];
  const pinned = new Set(settings.pinnedSessionIds);
  const shown = focused ? ordered.filter(session => session.projectId === focused.id && (!needle || focused.name.toLocaleLowerCase().includes(needle) || titleMatch(session))) : [];
  // Snoozed conversations wait under their own group at the end of the column (ADR-103).
  const archived = new Set(settings.archivedSessionIds);
  const snoozedHere = focused ? snoozed.filter(session => session.projectId === focused.id && !archived.has(session.id) && (!needle || focused.name.toLocaleLowerCase().includes(needle) || titleMatch(session))) : [];
  const snoozeFrom = (session: Session) => { const anchor = sessionAnchor(`[data-session-row="${session.id}"]`); if (anchor) setSnoozing({ session, anchor }); };
  // A waiting session in another project is never invisible.
  const elsewhere = projects.some(row => row.id !== project?.id && projectStatus(row.id, sessions, unseen, computer) === "waiting");
  const close = () => { setOpen(false); setQuery(""); setFocus(null); setRemoteFocus(null); setHovering(false); };
  const choose = (id: string) => { close(); void useAppStore.getState().switchProject(id); };
  const openSession = (id: string) => { close(); const store = useAppStore.getState(); store.setMainView("session"); void store.selectSession(id); };
  const newSession = (id: string) => { close(); const store = useAppStore.getState(); void store.switchProject(id).then(() => store.requestNewSession()); };
  const saveFolders = (change: (current: typeof settings) => typeof settings) => { const store = useAppStore.getState(); void store.saveSettings(change(store.settings)); };
  const folderItems = (row: Project) => {
    const current = folderOf(settings, row.id);
    return [
      ...settings.projectFolders.filter(folder => folder.id !== current?.id).map(folder => ({ id: `move:${folder.id}`, group: "folders", label: t("folders.moveTo", { folder: folder.name }), icon: <Folder size={15} />, onSelect: () => saveFolders(value => moveProjectToFolder(value, row.id, folder.id)) })),
      ...(current ? [{ id: "out", group: "folders", label: t("folders.removeFrom", { folder: current.name }), icon: <FolderOutput size={15} />, onSelect: () => saveFolders(value => moveProjectToFolder(value, row.id, null)) }] : []),
      { id: "new-folder", group: "folders", label: t("folders.newWith"), icon: <FolderPlus size={15} />, onSelect: () => { close(); setFolderDialog({ projectId: row.id }); } },
    ];
  };
  const togglePin = (id: string) => { const store = useAppStore.getState(); void store.saveSettings({ ...store.settings, pinnedSessionIds: toggleSidebarId(store.settings.pinnedSessionIds, id) }); };
  const navigate = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = (cursor + (event.key === "ArrowDown" ? 1 : navRows.length - 1)) % Math.max(navRows.length, 1);
      setCursor(next);
      setFocus(navRows[next]?.id ?? null);
    } else if (event.key === "Enter" && navRows[cursor]) {
      event.preventDefault();
      choose(navRows[cursor].id);
    }
  };
  useEffect(() => { list.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" }); }, [cursor]);
  return <>
  <Popover open={open} onOpenChange={value => { setOpen(value); if (!value) { setQuery(""); setFocus(null); setHovering(false); } setCursor(0); }}>
    <PopoverTrigger asChild>
      <button type="button" className={placement === "sidebar" ? "header-project conversation-sidebar-project" : "header-project"} aria-label={t("tabs.switchProject")}
        onPointerEnter={placement === "header" ? hoverIn : undefined} onPointerLeave={placement === "header" ? hoverOut : undefined}
        // A click right after the hover opened it keeps it open instead of toggling it shut.
        onClick={event => { if (open && hover.current.opened && Date.now() - hover.current.at < 600) { event.preventDefault(); used(); } else if (open) hover.current.opened = false; else { hover.current.opened = false; window.clearTimeout(hover.current.timer); } }}>
        {project ? <ProjectGlyph project={project} size={14} /> : null}
        <span className="truncate">{project?.name ?? "Sirus Code"}</span>
        {/* The open project's uncommitted lines sit in its title, not in every switcher row. */}
        {currentDiff && (currentDiff.additions || currentDiff.deletions) ? <span className="header-switcher-diff header-project-diff" aria-label={t("project.diff", { additions: currentDiff.additions, deletions: currentDiff.deletions })}>
          <span data-kind="added">+{currentDiff.additions}</span><span data-kind="removed">-{currentDiff.deletions}</span>
        </span> : null}
        {elsewhere && <span className="header-tab-status" data-status="waiting" aria-label={t("tabs.waitingElsewhere")} role="img" />}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={8} onPointerEnter={event => { window.clearTimeout(hover.current.timer); if (event.pointerType !== "touch") setHovering(true); }} onPointerLeave={() => { setHovering(false); hoverOut(); }} onPointerDown={used} onKeyDown={used} onContextMenu={used} className="floating-material header-switcher" data-cascade={cascade ? "" : undefined} onOpenAutoFocus={event => { event.preventDefault(); if (!hover.current.opened) (event.currentTarget as HTMLElement | null)?.querySelector("input")?.focus(); }}
      // Opened by hover, it leaves focus where it was (the composer keeps it while the pointer passes by).
      onCloseAutoFocus={event => { if (hover.current.opened && !hover.current.used) event.preventDefault(); }}>
      <div className="header-switcher-projects">
        <label className="header-switcher-search">
          <Search size={13} aria-hidden="true" />
          <input value={query} placeholder={t("tabs.searchAll")} aria-label={t("tabs.searchAll")} onChange={event => { setQuery(event.target.value); setCursor(0); setFocus(null); }} onKeyDown={navigate} />
        </label>
        <div ref={list} className="header-switcher-list" role="listbox" aria-label={t("tabs.projects")} data-reorder-scope="">
          {entries.map((entry, position) => {
            // One project row; inside a closed folder it leaves the reorder and keyboard order.
            const projectRow = (row: Project, inFolder: boolean, shown: boolean) => {
              const index = navRows.indexOf(row);
              const status = projectStatus(row.id, sessions, unseen, computer);
              return <ProjectActions key={row.id} project={row} onEdit={() => { close(); setEditing(row); }} extraItems={folderItems(row)}>
                <button type="button" role="option" data-index={index} data-cascade-item="" data-in-folder={inFolder ? "" : undefined} style={cascadeIndex(position)} aria-selected={row.id === focused?.id} data-current={row.id === project?.id || undefined}
                  data-reorder-id={shown ? row.id : undefined} data-dragging={reorder.dragging === row.id || undefined} data-drop-edge={reorder.over?.id === row.id ? reorder.over.edge : undefined}
                  tabIndex={shown ? undefined : -1}
                  {...(needle || rows.length < 2 || !shown ? {} : reorder.bind(row.id))}
                  className="header-switcher-row" onMouseEnter={() => { setCursor(index); setFocus(row.id); setRemoteFocus(null); }} onFocus={() => { setFocus(row.id); setRemoteFocus(null); }} onClick={() => choose(row.id)}>
                  <ProjectGlyph project={row} size={15} />
                  <span className="header-tab-title" onMouseEnter={measureMarquee}><span>{row.name}</span></span>
                  <ComputerBadge members={merged.alsoOn[row.id]} />
                  <StatusDot status={status} label={t(`tabs.status.${status}`)} />
                  <span className="header-switcher-trail">
                    <span className="header-switcher-actions">
                      {([["review", "Review changes", GitCompareArrows], ["terminal", "New terminal session", SquareTerminal], ["new", "New thread", SquarePen]] as const).map(([kind, label, Icon]) =>
                        <span key={kind} role="button" tabIndex={-1} aria-label={t(label)} title={t(label)} data-no-reorder=""
                          onPointerDown={event => event.stopPropagation()}
                          onClick={event => { event.stopPropagation(); close(); void sidebarProjectAction(row.id, kind); }}><Icon size={13} /></span>)}
                    </span>
                  </span>
                </button>
              </ProjectActions>;
            };
            if (entry.kind === "project") return projectRow(entry.project, false, true);
            const { folder } = entry;
            return <div key={`folder:${folder.id}`} className="header-switcher-folder-group" role="group" aria-label={folder.name}>
              <ContextMenu activation="context-only" label={folder.name} items={[
                { id: "edit", label: t("folders.edit"), icon: <Pencil size={15} />, onSelect: () => { close(); setFolderDialog({ folder }); } },
                { id: "delete", label: t("folders.delete"), icon: <Trash2 size={15} />, destructive: true, onSelect: () => { close(); setDeletingFolder(folder); } },
              ]}>
                <button type="button" className="header-switcher-row header-switcher-folder" data-cascade-item="" style={cascadeIndex(position)} data-reorder-id={`folder:${folder.id}`}
                  data-drop-edge={reorder.over?.id === `folder:${folder.id}` ? "inside" : undefined} aria-expanded={entry.open}
                  onClick={() => { if (!needle) saveFolders(value => updateFolder(value, folder.id, { collapsed: !folder.collapsed })); }}>
                  <ProjectGlyph project={{ look: folder.look }} expanded={entry.open} size={15} />
                  <span className="header-tab-title"><span>{folder.name}</span></span>
                  {/* The disclosure sits at the row's end, where the count used to be. */}
                  <ChevronRight size={13} aria-hidden="true" className="header-switcher-folder-chevron" data-open={entry.open || undefined} />
                </button>
              </ContextMenu>
              {/* Grid rows animate between 0fr and 1fr, so the folder opens and closes smoothly. */}
              <div className="header-switcher-folder-body" data-open={entry.open || undefined} inert={!entry.open}>
                <div className="header-switcher-folder-items">{entry.members.map(row => projectRow(row, true, entry.open))}</div>
              </div>
            </div>;
          })}
          <SwitcherElsewhereProjects members={merged.elsewhere} needle={needle} focused={remoteFocus} onFocus={setRemoteFocus} onChoose={close} />
          {!entries.length && !merged.elsewhere.length && <p className="header-switcher-empty">{t("tabs.noProjects")}</p>}
        </div>
        <button type="button" className="header-switcher-footer" data-cascade-item="" style={cascadeIndex(entries.length)} onClick={() => { close(); useAppStore.getState().setCreateProjectOpen(true); }}>
          <FolderPlus size={14} aria-hidden="true" />{t("New project")}
        </button>
        <button type="button" className="header-switcher-footer header-switcher-footer-plain" data-cascade-item="" style={cascadeIndex(entries.length + 1)} onClick={() => { close(); setFolderDialog({}); }}>
          <Folder size={14} aria-hidden="true" />{t("folders.new")}
        </button>
      </div>
      {remoteMember ? <div className="header-switcher-sessions" aria-label={t("tabs.sessionsOf", { project: remoteMember.project.name })}>
        <div className="header-switcher-title" data-cascade-item="">
          <span className="min-w-0 flex-1 truncate">{remoteMember.project.name}</span>
        </div>
        <div className="header-switcher-list header-switcher-session-list">
          <SwitcherRemoteSessions members={[remoteMember]} needle={needle} onChoose={close} />
          {!remoteMember.sessions.length && <p className="header-switcher-empty">{t("Sessions you start will show up here")}</p>}
        </div>
      </div> : focused ? <div className="header-switcher-sessions" aria-label={t("tabs.sessionsOf", { project: focused.name })}>
        <div className="header-switcher-title" data-cascade-item="">
          <span className="min-w-0 flex-1 truncate">{focused.name}</span>
          <button type="button" className="header-switcher-new" aria-label={t("session.new")} title={t("session.new")} onClick={() => newSession(focused.id)}><SquarePen size={14} aria-hidden="true" /></button>
        </div>
        <div className="header-switcher-list header-switcher-session-list">
          {shown.map((session, index) => {
            const status = tabStatus(session, unseen, computer);
            const time = relativeTime(session.lastActivityAt);
            const isPinned = pinned.has(session.id);
            const active = ["starting", "running", "waiting"].includes(session.status);
            return <ContextMenu key={session.id} activation="context-only" label={t("session.actions")} items={[
              { id: "rename", label: t("session.rename"), icon: <Pencil size={15} />, onSelect: () => { close(); setSessionAction({ session, kind: "rename" }); } },
              { id: "pin", label: t(isPinned ? "Unpin session" : "Pin session"), icon: isPinned ? <PinOff size={15} /> : <Pin size={15} />, onSelect: () => togglePin(session.id) },
              { id: "archive", label: t("Archive session"), icon: <Archive size={15} />, onSelect: () => { close(); useAppStore.getState().requestArchive(session.id); } },
              snoozeItem(t, session, () => snoozeFrom(session)),
              ...moveItems(session).map(item => ({ ...item, onSelect: () => { close(); item.onSelect(); } })),
              { id: "delete", label: t("session.delete"), icon: <Trash2 size={15} />, group: "danger", destructive: true, disabled: active, onSelect: () => { close(); setSessionAction({ session, kind: "delete" }); } },
            ]}><div className="header-switcher-session" data-session-row={session.id} data-cascade-item="" style={cascadeIndex(index + 1)} data-current={session.id === useAppStore.getState().selectedSessionId || undefined}>
              <button type="button" className="header-switcher-session-open" onClick={() => openSession(session.id)}>
                <TabGlyph agent={session.agent} status={status} label={status !== "idle" ? t(`tabs.status.${status}`) : undefined} />
                <span className="header-tab-title" onMouseEnter={measureMarquee}><span>{session.title}</span></span>
                {isPinned ? <Pin size={11} aria-label={t("Pinned")} className="shrink-0 text-text-muted" /> : null}
              </button>
              <TerminalBadge sessionId={session.id} count={runningTerminals[session.id]?.length ?? 0} onReveal={close} />
              <span className="header-switcher-trail">
                <span className="header-switcher-time">{time === "now" ? t("Now") : time}</span>
                <span className="header-switcher-actions">
                  <button type="button" aria-label={t(isPinned ? "Unpin session" : "Pin session")} title={t(isPinned ? "Unpin session" : "Pin session")} onClick={() => togglePin(session.id)}>{isPinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
                  <button type="button" aria-label={t("Archive session")} title={t("Archive session")} onClick={() => useAppStore.getState().requestArchive(session.id)}><Archive size={13} /></button>
                </span>
              </span>
            </div></ContextMenu>;
          })}
          <SwitcherRemoteSessions members={alsoHere} needle={needle} onChoose={close} />
          {!shown.length && !alsoHere.some(member => member.sessions.length) && <p className="header-switcher-empty">{t(needle ? "tabs.noSessionsMatch" : "Sessions you start will show up here")}</p>}
          {snoozedHere.length ? <div className="header-switcher-snoozed" role="group" aria-label={t("snooze.group", { count: snoozedHere.length })}>
            <button type="button" className="header-switcher-snoozed-toggle" data-cascade-item="" style={cascadeIndex(shown.length + 1)} aria-expanded={snoozedOpen} onClick={() => setSnoozedOpen(value => !value)}>
              <ChevronDown size={12} aria-hidden="true" data-open={snoozedOpen || undefined} />{t("snooze.group", { count: snoozedHere.length })}
            </button>
            {snoozedOpen ? snoozedHere.map((session, index) => <ContextMenu key={session.id} activation="context-only" label={t("session.actions")} items={[
              { id: "return", label: t("snooze.returnNow"), icon: <Undo2 size={15} />, onSelect: () => void useAppStore.getState().snoozeSession(session.id, null) },
              { id: "change", label: t("snooze.changeTime"), icon: <Clock3 size={15} />, onSelect: () => snoozeFrom(session) },
            ]}><div className="header-switcher-session header-switcher-snoozed-row" data-session-row={session.id} data-cascade-item="" style={cascadeIndex(shown.length + 2 + index)}
              title={t("snooze.snoozedRow", { when: snoozeDeadline(new Date(session.snoozedUntil!), new Date(), settings.locale, t) })}>
              <span className="header-switcher-session-open">
                <Moon size={13} aria-hidden="true" className="shrink-0 text-text-muted" />
                <span className="header-switcher-snoozed-text">
                  <span className="header-tab-title" onMouseEnter={measureMarquee}><span>{session.title}</span></span>
                  <span className="header-switcher-countdown"><SnoozeCountdown until={session.snoozedUntil!} /></span>
                </span>
              </span>
              <span className="header-switcher-trail">
                <span className="header-switcher-actions header-switcher-snoozed-actions">
                  <button type="button" aria-label={t("snooze.returnNow")} title={t("snooze.returnNow")} onClick={() => void useAppStore.getState().snoozeSession(session.id, null)}><Undo2 size={13} /></button>
                  <button type="button" aria-label={t("snooze.changeTime")} title={t("snooze.changeTime")} onClick={() => snoozeFrom(session)}><Clock3 size={13} /></button>
                </span>
              </span>
            </div></ContextMenu>) : null}
          </div> : null}
        </div>
      </div> : null}
      {/* Inside the switcher's tree, so choosing a time does not dismiss the switcher. */}
      <SnoozePicker session={snoozing?.session ?? null} anchor={snoozing?.anchor ?? null} onClose={() => setSnoozing(null)} />
    </PopoverContent>
  </Popover>
  <ProjectFolderDialog folder={folderDialog?.folder} projectId={folderDialog?.projectId} open={folderDialog !== null} onOpenChange={value => { if (!value) setFolderDialog(null); }} />
  <ConfirmDialog open={deletingFolder !== null} onOpenChange={value => { if (!value) setDeletingFolder(null); }} title={`${t("folders.delete")} · ${deletingFolder?.name ?? ""}`} description={t("folders.deleteHelp")} confirmLabel={t("folders.delete")} cancelLabel={t("common.cancel")}
    onConfirm={() => { if (deletingFolder) saveFolders(value => deleteFolder(value, deletingFolder.id)); setDeletingFolder(null); }} />
  {editing ? <ProjectEditDialog project={editing} open onOpenChange={value => { if (!value) setEditing(null); }} /> : null}
  {sessionAction ? <SessionActionDialog session={sessionAction.session} action={sessionAction.kind} onClose={() => setSessionAction(null)} /> : null}
  </>;
}

/** Header: project switcher plus the project's open session tabs (T1 pills). */
export function HeaderTabs() {
  const tabMoveItems = useMoveMenu("session");
  const t = useTranslation();
  const project = useAppStore(selectCurrentProject);
  const sessions = useAppStore(selectListedSessions);
  const archived = useAppStore(state => state.settings.archivedSessionIds);
  const tabIds = useAppStore(state => (project ? state.openTabsByProject[project.id] : undefined));
  const selectedSessionId = useAppStore(state => state.selectedSessionId);
  const mainView = useAppStore(state => state.mainView);
  const draft = useAppStore(state => (project ? !!state.draftTabByProject[project.id] : false));
  const showTabs = useAppStore(state => state.settings.showSessionTabs);
  // The conversation list sidebar already lists every project's conversations, and the Project
  // style holds the switcher itself (ADR-139).
  const listSidebar = useAppStore(state => isColumnSidebar(state.settings.sidebarMode) && !state.sidebarCollapsed);
  const switcher = listSidebar ? null : <><ProjectSwitcher /><span className="header-tabs-separator" aria-hidden="true" /></>;
  const { unseen, computer } = useWaitingSets();
  const runningTerminals = useAppStore(state => state.runningTerminals);
  const tabs = useMemo(() => (project ? visibleTabSessions(tabIds ?? [], sessions, project.id, archived) : []), [project, tabIds, sessions, archived]);
  // Only the tabs that fit stay inline (the dock or a narrow window shrinks the
  // header); the active one always stays visible and the rest go to "+N".
  const list = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(VISIBLE_TABS);
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    const measure = () => {
      const gap = Number.parseFloat(getComputedStyle(node).columnGap) || 0;
      const slots = Math.floor((node.clientWidth + gap) / (TAB_MIN_READABLE + gap));
      setCapacity(Math.max(1, Math.min(VISIBLE_TABS, slots - Number(draft))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [draft]);
  const activeId = mainView === "session" ? selectedSessionId : null;
  const shown = useMemo(() => {
    const first = tabs.slice(0, capacity);
    const current = tabs.find(tab => tab.id === activeId);
    return current && !first.includes(current) ? [...first.slice(0, Math.max(0, capacity - 1)), current] : first;
  }, [tabs, capacity, activeId]);
  const overflow = tabs.filter(tab => !shown.includes(tab));
  const defaultAgent = useAppStore(state => state.settings.defaultAgent);
  const onDraft = mainView === "session" && !selectedSessionId;
  const active = mainView === "session" ? selectedSessionId : null;
  const shownKey = `${shown.map(tab => tab.id).join()}|${draft}|${onDraft}`;
  const glider = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const reorder = usePointerReorder({ axis: "x", onDrop: (source, target, edge) => { if (project) useAppStore.getState().moveHeaderTab(project.id, source, target, edge); } });
  const [leaving, setLeaving] = useState<string | null>(null);
  const [menuTab, setMenuTab] = useState<string | null>(null);
  const [tabAction, setTabAction] = useState<{ id: string; kind: "rename" | "delete" } | null>(null);
  const [tabSnooze, setTabSnooze] = useState<{ session: Session; anchor: HTMLElement } | null>(null);
  const tabActionSession = tabAction ? sessions.find(session => session.id === tabAction.id) ?? null : null;
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // One highlight glides to the active tab; first placement and resizes are instant.
  useLayoutEffect(() => {
    const box = list.current, mark = glider.current;
    if (!box || !mark) return;
    let target = "";
    const place = (instant: boolean) => {
      // Overflowing titles get the edge fade before any hover.
      box.querySelectorAll<HTMLElement>(".header-tab-title").forEach(title => title.toggleAttribute("data-overflow", (title.firstElementChild?.scrollWidth ?? 0) > title.clientWidth + 2));
      const tab = box.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      mark.toggleAttribute("data-visible", !!tab);
      if (!tab) return;
      const next = `${tab.offsetLeft}:${tab.offsetWidth}`;
      // A resize that leaves the active tab where it was must not cut short a glide in progress.
      if (instant && next === target) return;
      target = next;
      mark.toggleAttribute("data-instant", instant);
      mark.style.transform = `translateX(${tab.offsetLeft}px)`;
      mark.style.width = `${tab.offsetWidth}px`;
    };
    place(!placed.current);
    placed.current = true;
    // Every notice re-measures, the first one too: a tab can settle (a neighbour that just closed,
    // a late font) between the placement above and the observer's first report.
    const observer = new ResizeObserver(() => place(true));
    observer.observe(box);
    // A tab can change width while the list keeps its own: a new title, or a neighbour closing.
    box.querySelectorAll<HTMLElement>('[role="tab"]').forEach(tab => observer.observe(tab));
    return () => observer.disconnect();
  }, [active, shownKey, leaving]);

  if (!project) return null;
  const store = () => useAppStore.getState();
  const close = (id: string) => {
    setLeaving(id);
    // The pill collapses before the tab list changes.
    setTimeout(() => {
      setLeaving(null);
      store().closeHeaderTab(project.id, id);
      setToast(id);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 4000);
    }, 160);
  };
  const toastTitle = toast ? sessions.find(session => session.id === toast)?.title ?? "" : "";
  const label = (session: Session) => t(`tabs.status.${tabStatus(session, unseen, computer)}`);

  // Tabs off: only the conversation on screen, with its live mark.
  if (!showTabs) {
    const current = sessions.find(session => session.id === selectedSessionId && mainView === "session");
    return <div className="header-tabs titlebar-no-drag">
      {switcher}
      {current ? <span className="header-tab header-tab-single" data-active="">
        <TabGlyph agent={current.agent} status={tabStatus(current, unseen, computer)} label={label(current)} />
        <span className="header-tab-title"><span>{current.title}</span></span>
        <TerminalBadge sessionId={current.id} count={runningTerminals[current.id]?.length ?? 0} />
      </span> : null}
      <button type="button" className="header-tabs-new" aria-label={t("session.new")} title={t("session.new")} onClick={() => store().requestNewSession()}><Plus size={14} aria-hidden="true" /></button>
    </div>;
  }

  return <div className="header-tabs titlebar-no-drag">
    {switcher}
    <div className="header-tabs-context">
      <ContextMenu activation="context-only" label={t("tabs.actions")} items={menuTab ? [
        { id: "close", label: t("tabs.close"), icon: <X size={15} />, onSelect: () => close(menuTab) },
        { id: "others", label: t("tabs.closeOthers"), icon: <XCircle size={15} />, disabled: tabs.length < 2, onSelect: () => store().closeOtherHeaderTabs(project.id, menuTab) },
        { id: "right", label: t("tabs.closeRight"), icon: <ArrowRight size={15} />, disabled: tabs.at(-1)?.id === menuTab, onSelect: () => store().closeHeaderTabsToRight(project.id, menuTab) },
        { id: "reopen", label: t("tabs.reopen"), icon: <RotateCcw size={15} />, group: "reopen", disabled: !useAppStore.getState().closedItems.some(item => item.kind === "session"), onSelect: () => store().reopenHeaderTab() },
        { id: "rename", label: t("session.rename"), icon: <Pencil size={15} />, group: "session", onSelect: () => setTabAction({ id: menuTab, kind: "rename" }) },
        ...(() => {
          const session = tabs.find(tab => tab.id === menuTab);
          return session ? [snoozeItem(t, session, () => { const anchor = sessionAnchor(`[data-tab="${session.id}"]`); if (anchor) setTabSnooze({ session, anchor }); }, "session"), ...tabMoveItems(session)] : [];
        })(),
        { id: "delete", label: t("session.delete"), icon: <Trash2 size={15} />, group: "session", destructive: true, disabled: ["starting", "running", "waiting"].includes(tabs.find(tab => tab.id === menuTab)?.status ?? ""), onSelect: () => setTabAction({ id: menuTab, kind: "delete" }) },
      ] : []}>
      <div ref={list} className="header-tabs-list" data-reorder-scope="" role="tablist" aria-label={t("tabs.label")}
        onContextMenuCapture={event => setMenuTab((event.target as HTMLElement).closest<HTMLElement>("[data-tab]")?.dataset.tab ?? null)}>
        <span ref={glider} className="header-tabs-glider" aria-hidden="true" />
        {shown.map((session, index) => {
          const status = tabStatus(session, unseen, computer);
          return <div key={session.id} role="tab" tabIndex={session.id === active ? 0 : -1} aria-selected={session.id === active} data-tab={session.id}
            data-leaving={leaving === session.id || undefined} {...reorder.bind(session.id)}
            data-dragging={reorder.dragging === session.id || undefined} data-drop-edge={reorder.over?.id === session.id ? reorder.over.edge : undefined} title={`${session.title}${index < 9 ? `  ⌘${index + 1}` : ""}`}
            className="header-tab" style={{ "--tab-index": index } as CSSProperties}
            onClick={() => { if (session.id !== active) void store().selectSession(session.id); }}
            onAuxClick={event => { if (event.button === 1) { event.preventDefault(); close(session.id); } }}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void store().selectSession(session.id); }
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                const next = shown[(index + (event.key === "ArrowRight" ? 1 : shown.length - 1)) % shown.length];
                list.current?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
              }
              if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); close(session.id); }
            }}>
            <TabGlyph agent={session.agent} status={status} />
            <span className="header-tab-title" onMouseEnter={measureMarquee}><span>{session.title}</span></span>
            <span className="sr-only">{status !== "idle" ? label(session) : ""}</span>
            <TerminalBadge sessionId={session.id} count={runningTerminals[session.id]?.length ?? 0} inTab />
            <button type="button" className="header-tab-close" data-no-reorder="" tabIndex={-1} aria-label={t("tabs.closeNamed", { title: session.title })} onClick={event => { event.stopPropagation(); close(session.id); }}><X size={11} aria-hidden="true" /></button>
          </div>;
        })}
        {draft && <div role="tab" tabIndex={onDraft ? 0 : -1} aria-selected={onDraft} data-draft className="header-tab" style={{ "--tab-index": shown.length } as CSSProperties}
          onClick={() => { if (!onDraft) store().requestNewSession(); }}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); store().requestNewSession(); } }}>
          <ProviderIcon id={defaultAgent} size={13} className="rounded-none bg-transparent" />
          <span className="header-tab-title"><span>{t("session.new")}</span></span>
          {(tabs.length > 0 || !onDraft) && <button type="button" className="header-tab-close" data-no-reorder="" tabIndex={-1} aria-label={t("tabs.closeNamed", { title: t("session.new") })} onClick={event => { event.stopPropagation(); store().closeDraftTab(project.id); }}><X size={11} aria-hidden="true" /></button>}
        </div>}
      </div>
    </ContextMenu>
    </div>
    <Dropdown>
      <DropdownTrigger asChild><button type="button" className="header-tabs-more" data-empty={!overflow.length || undefined} aria-hidden={!overflow.length || undefined} tabIndex={overflow.length ? undefined : -1} disabled={!overflow.length} aria-label={t("tabs.more", { count: overflow.length })}>+{overflow.length}</button></DropdownTrigger>
      <DropdownContent align="end">
        {overflow.map(session => <DropdownItem key={session.id} onSelect={() => void store().selectSession(session.id)}>{session.title}</DropdownItem>)}
      </DropdownContent>
    </Dropdown>
    <button type="button" className="header-tabs-new" aria-label={t("session.new")} title={t("session.new")} onClick={() => store().requestNewSession()}><Plus size={14} aria-hidden="true" /></button>
    <AnimatePresence>{toast && <motion.div key="closed-tab" className="header-tabs-toast" role="status" exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}>
      <span>{t("tabs.closedToast", { title: toastTitle })}</span>
      <button type="button" onClick={() => { setToast(null); store().reopenHeaderTab(); }}>{t("tabs.undo")}</button>
    </motion.div>}</AnimatePresence>
    {tabActionSession ? <SessionActionDialog session={tabActionSession} action={tabAction?.kind ?? null} onClose={() => setTabAction(null)} /> : null}
    <SnoozePicker session={tabSnooze?.session ?? null} anchor={tabSnooze?.anchor ?? null} onClose={() => setTabSnooze(null)} />
  </div>;
}
