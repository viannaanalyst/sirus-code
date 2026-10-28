import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AgentResources } from "@/components/AgentResources";
import type { AppSettings, Project, Session } from "@/client/types";
import { Archive, ArrowLeft, ArrowRight, ArrowUpDown, ChartBar, Check, Clock3, Columns3, Folder, FolderPlus, Moon, PanelLeft, Pencil, Pin, PinOff, Rows, Search, Settings, Sparkles, SquarePen, Trash2 } from "@/components/icons/phosphor";
import { ContextMenu, type ContextMenuItem } from "@/components/arc/context-menu/context-menu";
import { ConversationHoverCard, useConversationHover } from "@/components/ConversationHoverCard";
import { ModelIcon } from "@/components/ModelIcon";
import { useMoveMenu } from "@/components/MoveSessionDialog";
import { useProjectMenu } from "@/components/ProjectActions";
import { ProjectHoverActions, SessionHoverActions } from "@/components/HoverActions";
import { ProjectGlyph } from "@/components/ProjectGlyph";
import { SessionActionDialog } from "@/components/SessionActions";
import { ArchiveConfirm } from "@/components/SidebarRows";
import { RailGlyph } from "@/components/SidebarRailMore";
import { SnoozePicker } from "@/components/SnoozePicker";
import { useTranslation } from "@/i18n/use-translation";
import { conversationListItems, conversationOrderSettings, conversationSortKeys, expandOpenFolder, itemOffsets, offsetWindow, openFolderIds, toggleOpenFolder, type ConversationListSettings } from "@/lib/conversation-list";
import { hasUnreadGithubItems } from "@/lib/github-seen";
import { tabStatus, type TabStatus } from "@/lib/header-tabs";
import { effectiveShortcut, shortcutLabel } from "@/lib/keybindings";
import { isAuxiliarySession } from "@/lib/pull-ask";
import { RAIL_LABELS } from "@/lib/rail";
import { relativeTime } from "@/lib/session-board";
import { holdSessionOrder, sessionOrderSignature, toggleSidebarId, type SessionOrderSnapshot } from "@/lib/sidebar-layout";
import type { SidebarMotion } from "@/lib/sidebar-motion";
import { SIDEBAR_WINDOW_THRESHOLD } from "@/lib/sidebar-window";
import { canSnooze } from "@/lib/snooze";
import { beginSplitDrag } from "@/lib/split-drag";
import { leafShowing, splitLeaves, SPLIT_MAX_PANES } from "@/lib/split-layout";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/primitives/Dropdown";
import { IconButton } from "@/primitives/IconButton";
import { ShortcutHint } from "@/primitives/ShortcutHint";
import { scheduleProjectDiffs, selectListedSessions, useAppStore } from "@/store/app-store";
import "@/styles/sidebar.css";
import "@/styles/header-tabs.css";
import "@/styles/conversation-sidebar.css";

const NAV_ITEMS = ["inbox", "tasks", "pulls"] as const;

/** Rail dots for the compact nav row: a session waits for the person, or an unread pull request. */
function useNavDots() {
  const needsYou = useAppStore(state => state.sessions.some(session => session.status === "waiting" && !isAuxiliarySession(session) && session.id !== state.selectedSessionId));
  const githubInbox = useAppStore(state => state.githubInbox);
  const githubSeen = useAppStore(state => state.settings.githubSeen);
  const githubSeenFloor = useAppStore(state => state.settings.githubSeenFloor);
  const pulls = useMemo(() => hasUnreadGithubItems(Object.values(githubInbox).flatMap(list => list.data?.items ?? []), githubSeen, githubSeenFloor), [githubInbox, githubSeen, githubSeenFloor]);
  return { inbox: needsYou, tasks: false, pulls };
}

function useWaitingSets() {
  const unseen = useAppStore(state => state.unseenSessionIds);
  const requests = useAppStore(state => state.computer?.requests);
  return useMemo(() => ({ unseen: new Set(unseen), computer: new Set((requests ?? []).map(request => request.sessionId)) }), [unseen, requests]);
}

const store = () => useAppStore.getState();
const saveSettings = (change: Partial<AppSettings>) => { const state = store(); void state.saveSettings({ ...state.settings, ...change }); };

/**
 * The column sidebar (ADR-139): recent conversations from every project, flat or in project
 * folders, with search, the list order, New project, Inbox / Tasks / PRs, usage rings, Archived
 * and Settings. It replaces the header's project switcher while it shows; ⌘S hides it.
 */
export function ConversationSidebar({ motion = null }: { motion?: SidebarMotion }) {
  const t = useTranslation();
  const width = useAppStore(state => state.sidebarWidth);
  const mainView = useAppStore(state => state.mainView);
  const customShortcuts = useAppStore(state => state.settings.customShortcuts);
  const index = useAppStore(state => state.navIndex);
  const historyLength = useAppStore(state => state.navHistory.length);
  const dots = useNavDots();
  const collapsed = useAppStore(state => state.sidebarCollapsed);
  // Hidden (⌘S), the rows unmount once the column has closed; the archive confirmation stays.
  const hidden = collapsed && !motion;
  // Edits made outside Sirus (an editor, a terminal) show up when the window comes back.
  useEffect(() => {
    window.addEventListener("focus", scheduleProjectDiffs);
    return () => window.removeEventListener("focus", scheduleProjectDiffs);
  }, []);
  const shortcut = (id: Parameters<typeof effectiveShortcut>[1]) => shortcutLabel(effectiveShortcut(customShortcuts, id));
  const headButton = "size-6 min-h-0 rounded-[6px] p-0 text-text-muted";
  const toolButton = "conversation-sidebar-tool size-7 min-h-0 rounded-[7px] p-0 text-text-muted";
  const back = <IconButton tooltip={false} label={t("Back")} disabled={index <= 0} onClick={() => store().goBack()} className={headButton}><ArrowLeft size={14} strokeWidth={1.7} /></IconButton>;
  const forward = <IconButton tooltip={false} label={t("Forward")} disabled={index >= historyLength - 1} onClick={() => store().goForward()} className={headButton}><ArrowRight size={14} strokeWidth={1.7} /></IconButton>;
  const collapse = <IconButton tooltip={false} label={t("sidebar.hide")} aria-expanded onClick={() => store().toggleSidebar()} className={headButton}><PanelLeft size={14} strokeWidth={1.7} fill="currentColor" /></IconButton>;
  const newConversation = <IconButton label={t("sidebarList.newConversation")} shortcut={shortcut("new-session")} onClick={() => store().requestNewSession()} className={toolButton}><SquarePen size={15} /></IconButton>;

  return <aside className="sidebar-material conversation-sidebar" aria-label={t("Sidebar")} data-motion={motion ?? undefined} style={{ width }}>
    <ArchiveConfirm />
    <div data-tauri-drag-region className="conversation-sidebar-head titlebar-drag">
      <span className="conversation-sidebar-brand" data-tauri-drag-region>Sirus <span>Code</span></span>
      <div className="conversation-sidebar-head-actions titlebar-no-drag">{back}{forward}{collapse}</div>
    </div>
    <div className="conversation-sidebar-tools">
      <button type="button" className="conversation-sidebar-search" onClick={() => store().setPaletteOpen(true)}>
        <Search size={14} aria-hidden="true" /><span>{t("sidebarList.search")}</span><ShortcutHint keys={shortcut("palette")} />
      </button>
      <OrderMenu />
      {/* The New project dialog offers opening a folder, creating one and cloning. */}
      <IconButton label={t("New project")} onClick={() => store().setCreateProjectOpen(true)} className={toolButton}><FolderPlus size={15} /></IconButton>
      {newConversation}
    </div>
    <nav className="conversation-sidebar-nav" aria-label={t("Navigation")}>
      {NAV_ITEMS.map(id => <button key={id} type="button" className="conversation-sidebar-nav-item" aria-current={mainView === id ? "page" : undefined} onClick={() => store().setMainView(id)}>
        <RailGlyph id={id} active={mainView === id} size={14} />
        <span>{id === "pulls" ? t("sidebarList.pulls") : t(RAIL_LABELS[id])}</span>
        {dots[id] ? <span className="conversation-sidebar-nav-dot" aria-hidden="true" /> : null}
      </button>)}
    </nav>
    {hidden ? <div className="flex-1" /> : <ConversationList />}
    {/* The quota rings stay on the 52 px rail; here the Usage page sits beside Archived and Settings. */}
    <div className="conversation-sidebar-foot">
      <AgentResources placement="foot" />
      <span className="flex-1" />
      <button type="button" className="sidebar-rail-button conversation-sidebar-foot-button" aria-label={t("usage.title")} title={t("usage.title")} aria-current={mainView === "usage" ? "page" : undefined} onClick={() => store().setMainView("usage")}>
        <ChartBar size={17} weight={mainView === "usage" ? "fill" : undefined} />
      </button>
      <button type="button" className="sidebar-rail-button conversation-sidebar-foot-button" aria-label={t(RAIL_LABELS.archived)} title={t(RAIL_LABELS.archived)} aria-current={mainView === "archived" ? "page" : undefined} onClick={() => store().setMainView("archived")}>
        <RailGlyph id="archived" active={mainView === "archived"} size={17} />
      </button>
      <button type="button" className="sidebar-rail-button conversation-sidebar-foot-button" data-section="settings" aria-label={t("Settings")} title={t("Settings")} onClick={() => store().setSettingsOpen(true)}>
        <Settings size={17} />
      </button>
    </div>
  </aside>;
}

/** The list order (Recent or By project) and "Working and unread first". */
function OrderMenu() {
  const t = useTranslation();
  const order = useAppStore(state => state.settings.sidebarListOrder);
  const attentionFirst = useAppStore(state => state.settings.sidebarAttentionFirst);
  const mark = (on: boolean, label: string) => <span className="flex min-w-[140px] items-center gap-2"><span className="flex-1">{label}</span>{on ? <Check size={13} aria-hidden="true" /> : null}</span>;
  return <Dropdown>
    <DropdownTrigger asChild><button type="button" className="conversation-sidebar-tool conversation-sidebar-order" aria-label={t("sidebarList.order")} title={t("sidebarList.order")}><ArrowUpDown size={15} aria-hidden="true" /></button></DropdownTrigger>
    <DropdownContent align="start" className="min-w-[200px]">
      {([["recent", "sidebarList.recent", <Clock3 key="icon" size={15} />], ["project", "sidebarList.byProject", <Folder key="icon" size={15} />]] as const).map(([value, label, icon]) =>
        <DropdownItem key={value} icon={icon} onSelect={() => { if (order !== value) saveSettings({ sidebarListOrder: value }); }}>{mark(order === value, t(label))}</DropdownItem>)}
      <DropdownSeparator />
      <DropdownItem icon={<Sparkles size={15} />} onSelect={() => saveSettings({ sidebarAttentionFirst: !attentionFirst })}>{mark(attentionFirst, t("Working and unread first"))}</DropdownItem>
    </DropdownContent>
  </Dropdown>;
}

/**
 * The rows, windowed like `SidebarWindowedRows` past 60 items (two fixed heights, both
 * measured: conversation rows, and headers — project folders and Show more). The order holds
 * still while the pointer is over the list (ADR-121) and settles when it leaves.
 */
/** Folder rows grow in over this long (with their stagger), and fold away before leaving. */
const FOLDER_OPEN_MS = 420;
const FOLDER_CLOSE_MS = 170;

function ConversationList() {
  const t = useTranslation();
  const projects = useAppStore(state => state.projects);
  const sessions = useAppStore(selectListedSessions);
  const order = useAppStore(state => state.settings.sidebarListOrder);
  const archivedSessionIds = useAppStore(state => state.settings.archivedSessionIds);
  const pinnedSessionIds = useAppStore(state => state.settings.pinnedSessionIds);
  const sidebarAttentionFirst = useAppStore(state => state.settings.sidebarAttentionFirst);
  const savedOpenFolders = useAppStore(state => state.settings.sidebarOpenFolders);
  const selectedProjectId = useAppStore(state => state.selectedProjectId);
  const selectedSessionId = useAppStore(state => state.mainView === "session" ? state.selectedSessionId : null);
  const listSettings = useMemo<ConversationListSettings>(() => ({ archivedSessionIds, pinnedSessionIds, sidebarAttentionFirst, sidebarThreadSortOrder: "updated_at" }), [archivedSessionIds, pinnedSessionIds, sidebarAttentionFirst]);
  const { unseen, computer } = useWaitingSets();
  const [hovering, setHovering] = useState(false);
  // Ages refresh when the person comes back to the window or points at the list; no timer.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== "hidden") setNow(Date.now()); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const liveOrder = useMemo<SessionOrderSnapshot>(() => ({ signature: `${sessionOrderSignature(conversationOrderSettings(listSettings))}:${order}`, keys: conversationSortKeys(sessions, listSettings, { unseen, computer }) }), [sessions, listSettings, order, unseen, computer]);
  const [heldOrder, setHeldOrder] = useState(liveOrder);
  const held = holdSessionOrder(heldOrder, liveOrder, hovering);
  if (held !== heldOrder) setHeldOrder(held);

  // Project folders (By project): the saved open ones, else the selected project's.
  const openFolders = useMemo(() => new Set(openFolderIds(savedOpenFolders, selectedProjectId)), [savedOpenFolders, selectedProjectId]);
  // Opening grows the folder's rows in; closing folds them away before they leave the list.
  const reduced = useMotionPreferences();
  const [folderMotion, setFolderMotion] = useState<{ projectId: string; kind: "open" | "close" } | null>(null);
  const motionTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(motionTimer.current), []);
  const toggleFolder = useCallback((projectId: string) => {
    const state = store();
    const open = openFolderIds(state.settings.sidebarOpenFolders, state.selectedProjectId);
    const save = () => saveSettings({ sidebarOpenFolders: toggleOpenFolder(open, projectId) });
    window.clearTimeout(motionTimer.current);
    if (reduced) { setFolderMotion(null); save(); return; }
    if (open.includes(projectId)) {
      setFolderMotion({ projectId, kind: "close" });
      motionTimer.current = window.setTimeout(() => { save(); setFolderMotion(null); }, FOLDER_CLOSE_MS);
    } else {
      save();
      setFolderMotion({ projectId, kind: "open" });
      motionTimer.current = window.setTimeout(() => setFolderMotion(null), FOLDER_OPEN_MS);
    }
  }, [reduced]);
  // Show more / Show less per folder, for this window only.
  const [fullFolders, setFullFolders] = useState<ReadonlySet<string>>(() => new Set());
  const toggleFull = useCallback((projectId: string) => setFullFolders(current => {
    const next = new Set(current);
    if (!next.delete(projectId)) next.add(projectId);
    return next;
  }), []);
  // Selecting a conversation (anywhere: tabs, palette, Inbox) opens its folder.
  const seenSelection = useRef(selectedSessionId);
  useEffect(() => {
    if (seenSelection.current === selectedSessionId) return;
    seenSelection.current = selectedSessionId;
    if (order !== "project" || !selectedSessionId || !selectedProjectId) return;
    const state = store();
    const next = expandOpenFolder(openFolderIds(state.settings.sidebarOpenFolders, selectedProjectId), selectedProjectId);
    if (next) saveSettings({ sidebarOpenFolders: next });
  }, [order, selectedSessionId, selectedProjectId]);

  const items = useMemo(() => conversationListItems(projects, sessions, listSettings, order, { unseen, computer, held: held.keys, openFolders, fullFolders, keep: selectedSessionId }),
    [order, projects, sessions, listSettings, selectedSessionId, unseen, computer, held, openFolders, fullFolders]);

  // Windowing: only the items near the visible area mount past the threshold.
  const viewport = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const windowed = items.length > SIDEBAR_WINDOW_THRESHOLD;
  const [metrics, setMetrics] = useState({ row: 64, header: 30 });
  const kinds = useMemo(() => items.map(item => item.kind), [items]);
  const offsets = useMemo(() => itemOffsets(kinds, metrics.row, metrics.header), [kinds, metrics]);
  const [range, setRange] = useState({ start: 0, end: SIDEBAR_WINDOW_THRESHOLD });
  useLayoutEffect(() => {
    const node = viewport.current, list = inner.current;
    if (!windowed || !node || !list) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const row = list.querySelector<HTMLElement>(':scope > [data-list-kind="session"]')?.offsetHeight ?? 0;
      const header = list.querySelector<HTMLElement>(':scope > [data-list-kind]:not([data-list-kind="session"])')?.offsetHeight ?? 0;
      if ((row && row !== metrics.row) || (header && header !== metrics.header)) { setMetrics({ row: row || metrics.row, header: header || metrics.header }); return; }
      const listTop = list.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop;
      const next = offsetWindow(offsets, node.scrollTop - listTop, node.clientHeight);
      setRange(current => current.start === next.start && current.end === next.end ? current : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    node.addEventListener("scroll", schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(node);
    return () => { cancelAnimationFrame(frame); node.removeEventListener("scroll", schedule); resize.disconnect(); };
  }, [windowed, offsets, metrics]);
  const start = windowed ? Math.min(range.start, items.length) : 0;
  const end = windowed ? Math.min(range.end, items.length) : items.length;

  // One hover card for the whole list, driven by delegated pointer events (rows never re-render for it).
  const hover = useConversationHover();
  // One context menu for the whole list: the row under the pointer picks its items (a
  // conversation's, or its project's on a folder row); elsewhere no menu opens.
  const [menuTarget, setMenuTarget] = useState<{ kind: "session" | "project"; id: string } | null>(null);
  const [action, setAction] = useState<{ session: Session; kind: "rename" | "delete" } | null>(null);
  const [snoozing, setSnoozing] = useState<{ session: Session; anchor: HTMLElement } | null>(null);
  const moveItems = useMoveMenu();
  const { items: projectItems, dialogs: projectDialogs } = useProjectMenu();
  const menuSession = menuTarget?.kind === "session" ? sessions.find(session => session.id === menuTarget.id) ?? null : null;
  const menuProject = menuTarget?.kind === "project" ? projects.find(project => project.id === menuTarget.id) ?? null : null;
  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (menuProject) return projectItems(menuProject);
    if (!menuSession) return [];
    const state = useAppStore.getState();
    const leaves = splitLeaves(state.splitLayout.root);
    const canSplit = leafShowing(state.splitLayout, menuSession.id) ? leaves.length > 1 : leaves.length < SPLIT_MAX_PANES && Boolean(state.selectedSessionId);
    const pinned = state.settings.pinnedSessionIds.includes(menuSession.id);
    const busy = ["starting", "running", "waiting"].includes(menuSession.status);
    const snoozable = canSnooze(menuSession);
    return [
      { id: "split-right", label: t("split.openRight"), icon: <Columns3 size={15} />, disabled: !canSplit, onSelect: () => useAppStore.getState().openInSplit(menuSession.id, "right") },
      { id: "split-down", label: t("split.openDown"), icon: <Rows size={15} />, disabled: !canSplit, onSelect: () => useAppStore.getState().openInSplit(menuSession.id, "bottom") },
      { id: "rename", label: t("session.rename"), icon: <Pencil size={15} />, group: "edit", onSelect: () => setAction({ session: menuSession, kind: "rename" }) },
      { id: "pin", label: t(pinned ? "Unpin session" : "Pin session"), icon: pinned ? <PinOff size={15} /> : <Pin size={15} />, group: "edit", onSelect: () => { const current = useAppStore.getState(); void current.saveSettings({ ...current.settings, pinnedSessionIds: toggleSidebarId(current.settings.pinnedSessionIds, menuSession.id) }); } },
      { id: "snooze", label: t("snooze.menu"), icon: <Moon size={15} />, group: "edit", disabled: !snoozable, hint: snoozable ? undefined : t("snooze.activeHint"), onSelect: () => { const anchor = document.querySelector<HTMLElement>(`[data-conversation="${menuSession.id}"]`); if (anchor) setSnoozing({ session: menuSession, anchor }); } },
      { id: "archive", label: t("Archive session"), icon: <Archive size={15} />, group: "edit", onSelect: () => useAppStore.getState().requestArchive(menuSession.id) },
      ...moveItems(menuSession),
      { id: "delete", label: t("session.delete"), icon: <Trash2 size={15} />, group: "danger", destructive: true, disabled: busy, onSelect: () => setAction({ session: menuSession, kind: "delete" }) },
    ];
  }, [menuSession, menuProject, moveItems, projectItems, t]);

  // Position under its folder, for the open stagger.
  let depth = 0;
  return <div ref={viewport} className="conversation-sidebar-list scroll-thin" aria-label={t("sidebarList.label")} data-order={order}
    onPointerEnter={event => { setNow(Date.now()); if (event.pointerType !== "touch") setHovering(true); }} onPointerLeave={() => setHovering(false)} onScroll={hover.onScroll}>
    {items.length ? <ContextMenu activation="context-only" label={t(menuProject ? "project.actions" : "session.actions")} items={menuItems} onOpenChange={hover.onMenuOpenChange}>
      <div ref={inner} className="conversation-sidebar-rows" style={windowed ? { paddingTop: offsets[start], paddingBottom: offsets[items.length] - offsets[end] } : undefined}
        onPointerOver={hover.onPointerOver} onPointerLeave={hover.onPointerLeave} onPointerDown={hover.onPointerDown}
        onContextMenuCapture={event => {
          const target = event.target as HTMLElement;
          const conversation = target.closest<HTMLElement>("[data-conversation]")?.dataset.conversation;
          const folder = conversation ? undefined : target.closest<HTMLElement>("[data-project-folder]")?.dataset.projectFolder;
          setMenuTarget(conversation ? { kind: "session", id: conversation } : folder ? { kind: "project", id: folder } : null);
          // Nothing to offer here (Show more): no menu, not even an empty one.
          if (!conversation && !folder) { event.preventDefault(); event.stopPropagation(); }
        }}>
        {items.slice(start, end).map(item => {
          if (item.kind === "folder") depth = 0;
          if (item.kind === "folder") return <FolderRow key={item.key} project={item.project} count={item.count} status={item.status} open={item.open && folderMotion?.kind !== "close"} onToggle={toggleFolder} />;
          // Rows of the folder opening or closing animate, staggered from the folder down.
          const projectId = item.kind === "more" ? item.projectId : item.project.id;
          const motion = folderMotion?.projectId === projectId ? folderMotion.kind : undefined;
          const row = depth++;
          if (item.kind === "more") return <MoreRow key={item.key} projectId={item.projectId} hidden={item.hidden} motion={motion} depth={row} onToggle={toggleFull} />;
          return <ConversationRow key={item.key} session={item.session} project={item.project} pinned={item.pinned} variant={item.nested ? "nested" : "full"}
            active={item.session.id === selectedSessionId} status={tabStatus(item.session, unseen, computer)} age={relativeTime(item.session.lastActivityAt, now)} motion={motion} depth={row} />;
        })}
      </div>
    </ContextMenu> : <p className="conversation-sidebar-empty">{t("sidebarList.empty")}</p>}
    <ConversationHoverCard controller={hover.controller} />
    {action ? <SessionActionDialog session={action.session} action={action.kind} onClose={() => setAction(null)} /> : null}
    <SnoozePicker session={snoozing?.session ?? null} anchor={snoozing?.anchor ?? null} onClose={() => setSnoozing(null)} />
    {projectDialogs}
  </div>;
}

/** A dot for the strongest state: working, waiting, or unread (finished while away). */
function statusDotOf(status: TabStatus, active: boolean): "running" | "waiting" | "unread" | null {
  return status === "running" || status === "waiting" ? status : status === "done" && !active ? "unread" : null;
}

/** By project: one folder per project (the row opens and closes it; closed, its status dot at the end); open, its conversations follow it, indented. */
const FolderRow = memo(function FolderRow({ project, count, status, open, onToggle }: { project: Project; count: number; status: TabStatus; open: boolean; onToggle: (projectId: string) => void }) {
  const t = useTranslation();
  const dot = statusDotOf(status, false);
  // The project's uncommitted lines, as the header switcher shows them.
  const diff = useAppStore(state => state.projectDiffs[project.id]);
  const label = [t("sidebarList.projectCount", { project: project.name, count }), diff && (diff.additions || diff.deletions) ? t("project.diff", { additions: diff.additions, deletions: diff.deletions }) : null, dot ? t(dot === "unread" ? "sidebarList.unread" : `tabs.status.${dot}`) : null].filter(Boolean).join(" · ");
  return <div className="conversation-folder" data-list-kind="folder" data-project-folder={project.id} data-open={open || undefined}>
    <button type="button" className="conversation-folder-toggle" aria-expanded={open} aria-label={label} onClick={() => onToggle(project.id)}>
      <ProjectGlyph project={project} expanded={open} size={14} />
      <span className="conversation-folder-name">{project.name}</span>
      {diff && (diff.additions || diff.deletions) ? <span className="header-switcher-diff conversation-folder-diff" aria-hidden="true">
        <span data-kind="added">+{diff.additions}</span><span data-kind="removed">-{diff.deletions}</span>
      </span> : null}
      {/* Closed, the most urgent state takes the chevron's place; open, the rows show their own. */}
      {/* No chevron: the whole row opens and closes the folder. Closed, its most urgent state shows at the end. */}
      {dot && !open ? <span className="conversation-folder-end"><span className="header-tab-status conversation-folder-dot" data-status={dot} aria-hidden="true" /></span> : null}
    </button>
    <ProjectHoverActions projectId={project.id} className="header-switcher-actions conversation-hover-actions" />
  </div>;
});

/** Under an open folder with more than `FOLDER_PREVIEW` conversations: Show more or Show less. */
const MoreRow = memo(function MoreRow({ projectId, hidden, motion, depth, onToggle }: { projectId: string; hidden: number; motion?: "open" | "close"; depth: number; onToggle: (projectId: string) => void }) {
  const t = useTranslation();
  return <div className="conversation-more" data-list-kind="more" data-motion={motion} style={motion ? { "--row-index": depth } as CSSProperties : undefined}>
    <button type="button" className="conversation-more-toggle" onClick={() => onToggle(projectId)}>{hidden ? t("sidebarList.showMore", { count: hidden }) : t("sidebarList.showLess")}</button>
  </div>;
});

/**
 * "full" (Recent): project and age with the live dot, the title, branch and model mark.
 * "nested" (in a folder): one line with the dot, title, the branch when the conversation has
 * its own worktree, and age; the model is in the tooltip.
 */
const ConversationRow = memo(function ConversationRow({ session, project, status, active, pinned, age, variant, motion, depth = 0 }: { session: Session; project: Project; status: TabStatus; active: boolean; pinned: boolean; age: string; variant: "full" | "nested"; motion?: "open" | "close"; depth?: number }) {
  const t = useTranslation();
  const dot = statusDotOf(status, active);
  const statusLabel = dot === "unread" ? t("sidebarList.unread") : dot ? t(`tabs.status.${dot}`) : null;
  const ageText = <span className="conversation-row-age">{age === "now" ? t("Now") : age}</span>;
  const dotMark = dot ? <span className="header-tab-status" data-status={dot} aria-hidden="true" /> : null;
  const nested = variant === "nested";
  const title = <span className="conversation-row-title">{variant === "full" ? null : dotMark ?? (nested ? <span className="conversation-row-dot-space" aria-hidden="true" /> : null)}{pinned ? <Pin size={11} aria-hidden="true" /> : null}<span>{session.title}</span>
    {nested && session.worktree.isolated ? <span className="conversation-row-branch">{session.worktree.branch}</span> : null}
    {variant === "full" ? null : ageText}</span>;
  const detail = <span className="conversation-row-detail">
    <span className="conversation-row-branch">{session.worktree.branch}</span>
    <ModelIcon modelId={session.model ?? ""} provider={session.agent} size={13} />
  </span>;
  return <div className="conversation-row" data-list-kind="session" data-variant={variant} data-conversation={session.id} data-active={active || undefined} data-unread={dot === "unread" || undefined}
    data-motion={motion} style={motion ? { "--row-index": depth } as CSSProperties : undefined}>
    <button type="button" className="conversation-row-open" aria-current={active ? "page" : undefined}
      aria-label={[session.title, variant === "full" ? project.name : null, statusLabel].filter(Boolean).join(" · ")}
      onPointerDown={event => beginSplitDrag(event, session.id, session.title)}
      onClick={() => void useAppStore.getState().selectSession(session.id)}>
      {variant === "full" ? <span className="conversation-row-meta">
        <ProjectGlyph project={project} size={13} />
        <span className="conversation-row-project">{project.name}</span>
        {ageText}
        {dotMark}
      </span> : null}
      {title}
      {variant === "full" ? detail : null}
    </button>
    {/* Pin and Archive while pointed at, as in the header switcher; they take the age's place. */}
    <SessionHoverActions sessionId={session.id} pinned={pinned} className="header-switcher-actions conversation-hover-actions" />
  </div>;
});

