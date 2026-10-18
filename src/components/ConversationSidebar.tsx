import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Project, Session } from "@/client/types";
import { Archive, ArrowLeft, ArrowRight, ArrowUpDown, Check, Clock3, Columns3, Folder, FolderOpen, FolderPlus, Moon, PanelLeft, Pencil, Pin, PinOff, Rows, Search, Settings, SquarePen, Trash2 } from "@/components/icons/phosphor";
import { ContextMenu, type ContextMenuItem } from "@/components/arc/context-menu/context-menu";
import { ModelIcon } from "@/components/ModelIcon";
import { useMoveMenu } from "@/components/MoveSessionDialog";
import { ProjectGlyph } from "@/components/ProjectGlyph";
import { SessionActionDialog } from "@/components/SessionActions";
import { ArchiveConfirm } from "@/components/SidebarRows";
import { RailGlyph } from "@/components/SidebarRailMore";
import { SidebarUsageRings } from "@/components/SidebarUsageRings";
import { SnoozePicker } from "@/components/SnoozePicker";
import { useTranslation } from "@/i18n/use-translation";
import { conversationListItems, conversationOrderSettings, conversationSortKeys, CONVERSATION_LIST_MAX_WIDTH, CONVERSATION_LIST_MIN_WIDTH, itemOffsets, offsetWindow, type ConversationListSettings } from "@/lib/conversation-list";
import { hasUnreadGithubItems } from "@/lib/github-seen";
import { tabStatus, type TabStatus } from "@/lib/header-tabs";
import { effectiveShortcut, shortcutLabel } from "@/lib/keybindings";
import { isAuxiliarySession } from "@/lib/pull-ask";
import { RAIL_LABELS } from "@/lib/rail";
import { relativeTime } from "@/lib/session-board";
import { sidebarProjectAction } from "@/lib/sidebar-actions";
import { holdSessionOrder, sessionOrderSignature, toggleSidebarId, type SessionOrderSnapshot } from "@/lib/sidebar-layout";
import type { SidebarMotion } from "@/lib/sidebar-motion";
import { SIDEBAR_WINDOW_THRESHOLD } from "@/lib/sidebar-window";
import { canSnooze } from "@/lib/snooze";
import { beginSplitDrag } from "@/lib/split-drag";
import { leafShowing, splitLeaves, SPLIT_MAX_PANES } from "@/lib/split-layout";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/primitives/Dropdown";
import { IconButton } from "@/primitives/IconButton";
import { ResizeHandle } from "@/primitives/ResizablePanel";
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

/**
 * The conversation list sidebar (ADR-139): recent conversations from every project in a
 * resizable column, with search, project actions, Inbox / Tasks / PRs, usage rings, Archived
 * and Settings. It replaces the header's project switcher while it shows; ⌘B hides it.
 */
export function ConversationSidebar({ motion = null }: { motion?: SidebarMotion }) {
  const t = useTranslation();
  const width = useAppStore(state => state.sidebarWidth);
  const mainView = useAppStore(state => state.mainView);
  const customShortcuts = useAppStore(state => state.settings.customShortcuts);
  const order = useAppStore(state => state.settings.sidebarListOrder);
  const index = useAppStore(state => state.navIndex);
  const historyLength = useAppStore(state => state.navHistory.length);
  const dots = useNavDots();
  // Hidden (⌘B), the rows unmount once the column has closed; the archive confirmation stays.
  const hidden = useAppStore(state => state.sidebarCollapsed) && !motion;
  // Edits made outside Sirus (an editor, a terminal) show up when the window comes back.
  useEffect(() => {
    window.addEventListener("focus", scheduleProjectDiffs);
    return () => window.removeEventListener("focus", scheduleProjectDiffs);
  }, []);
  const store = () => useAppStore.getState();
  const shortcut = (id: Parameters<typeof effectiveShortcut>[1]) => shortcutLabel(effectiveShortcut(customShortcuts, id));
  const setOrder = (sidebarListOrder: "recent" | "project") => { const state = store(); if (state.settings.sidebarListOrder !== sidebarListOrder) void state.saveSettings({ ...state.settings, sidebarListOrder }); };
  const headButton = "size-6 min-h-0 rounded-[6px] p-0 text-text-muted";
  const toolButton = "conversation-sidebar-tool size-7 min-h-0 rounded-[7px] p-0 text-text-muted";

  return <aside className="sidebar-material conversation-sidebar" aria-label={t("Sidebar")} data-motion={motion ?? undefined} style={{ width }}>
    <ArchiveConfirm />
    <div data-tauri-drag-region className="conversation-sidebar-head titlebar-drag">
      <span className="conversation-sidebar-brand" data-tauri-drag-region>Sirus <span>Code</span></span>
      <div className="conversation-sidebar-head-actions titlebar-no-drag">
        <IconButton tooltip={false} label={t("Back")} disabled={index <= 0} onClick={() => store().goBack()} className={headButton}><ArrowLeft size={14} strokeWidth={1.7} /></IconButton>
        <IconButton tooltip={false} label={t("Forward")} disabled={index >= historyLength - 1} onClick={() => store().goForward()} className={headButton}><ArrowRight size={14} strokeWidth={1.7} /></IconButton>
        <Dropdown>
          <DropdownTrigger asChild><button type="button" className="conversation-sidebar-head-button" aria-label={t("sidebarList.order")} title={t("sidebarList.order")}><ArrowUpDown size={14} aria-hidden="true" /></button></DropdownTrigger>
          <DropdownContent align="end" className="min-w-[180px]">
            {([["recent", "sidebarList.recent", <Clock3 key="icon" size={15} />], ["project", "sidebarList.byProject", <Folder key="icon" size={15} />]] as const).map(([value, label, icon]) => <DropdownItem key={value} icon={icon} onSelect={() => setOrder(value)}>
              <span className="flex min-w-[120px] items-center gap-2"><span className="flex-1">{t(label)}</span>{order === value ? <Check size={13} aria-hidden="true" /> : null}</span>
            </DropdownItem>)}
          </DropdownContent>
        </Dropdown>
        <IconButton tooltip={false} label={t("sidebar.hide")} aria-expanded onClick={() => store().toggleSidebar()} className={headButton}><PanelLeft size={14} strokeWidth={1.7} /></IconButton>
      </div>
    </div>
    <div className="conversation-sidebar-tools">
      <button type="button" className="conversation-sidebar-search" onClick={() => store().setPaletteOpen(true)}>
        <Search size={14} aria-hidden="true" /><span>{t("sidebarList.search")}</span><ShortcutHint keys={shortcut("palette")} />
      </button>
      <IconButton label={t("Open Project")} shortcut={shortcut("open-project")} onClick={() => void store().addProjectFromPicker()} className={toolButton}><FolderOpen size={15} /></IconButton>
      <IconButton label={t("newProject.title")} onClick={() => store().setCreateProjectOpen(true)} className={toolButton}><FolderPlus size={15} /></IconButton>
      <IconButton label={t("sidebarList.newConversation")} shortcut={shortcut("new-session")} onClick={() => store().requestNewSession()} className={toolButton}><SquarePen size={15} /></IconButton>
    </div>
    <nav className="conversation-sidebar-nav" aria-label={t("Navigation")}>
      {NAV_ITEMS.map(id => <button key={id} type="button" className="conversation-sidebar-nav-item" aria-current={mainView === id ? "page" : undefined} onClick={() => store().setMainView(id)}>
        <RailGlyph id={id} active={mainView === id} size={14} />
        <span>{id === "pulls" ? t("sidebarList.pulls") : t(RAIL_LABELS[id])}</span>
        {dots[id] ? <span className="conversation-sidebar-nav-dot" aria-hidden="true" /> : null}
      </button>)}
    </nav>
    {hidden ? <div className="flex-1" /> : <ConversationList />}
    <div className="conversation-sidebar-foot">
      <SidebarUsageRings />
      <span className="flex-1" />
      <button type="button" className="sidebar-rail-button conversation-sidebar-foot-button" aria-label={t(RAIL_LABELS.archived)} title={t(RAIL_LABELS.archived)} aria-current={mainView === "archived" ? "page" : undefined} onClick={() => store().setMainView("archived")}>
        <RailGlyph id="archived" active={mainView === "archived"} size={17} />
      </button>
      <button type="button" className="sidebar-rail-button conversation-sidebar-foot-button" data-section="settings" aria-label={t("Settings")} title={t("Settings")} onClick={() => store().setSettingsOpen(true)}>
        <Settings size={17} />
      </button>
    </div>
    <div className="conversation-sidebar-resize">
      <ResizeHandle value={width} min={CONVERSATION_LIST_MIN_WIDTH} max={CONVERSATION_LIST_MAX_WIDTH} label={t("sidebarList.resize")} onResize={delta => store().resizeSidebar(delta)} />
    </div>
  </aside>;
}

/**
 * The rows, windowed like `SidebarWindowedRows` past 60 items (two fixed heights: project
 * headers and conversation rows, both measured). The order holds still while the pointer is
 * over the list (ADR-121) and settles when it leaves.
 */
function ConversationList() {
  const t = useTranslation();
  const projects = useAppStore(state => state.projects);
  const sessions = useAppStore(selectListedSessions);
  const order = useAppStore(state => state.settings.sidebarListOrder);
  const archivedSessionIds = useAppStore(state => state.settings.archivedSessionIds);
  const pinnedSessionIds = useAppStore(state => state.settings.pinnedSessionIds);
  const sidebarAttentionFirst = useAppStore(state => state.settings.sidebarAttentionFirst);
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
  const items = useMemo(() => conversationListItems(projects, sessions, listSettings, order, { unseen, computer, held: held.keys }), [projects, sessions, listSettings, order, unseen, computer, held]);

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
      const header = list.querySelector<HTMLElement>(':scope > [data-list-kind="project"]')?.offsetHeight ?? 0;
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

  // One context menu for the whole list: the row under the pointer picks its items.
  const [menuId, setMenuId] = useState<string | null>(null);
  const [action, setAction] = useState<{ session: Session; kind: "rename" | "delete" } | null>(null);
  const [snoozing, setSnoozing] = useState<{ session: Session; anchor: HTMLElement } | null>(null);
  const moveItems = useMoveMenu();
  const menuSession = menuId ? sessions.find(session => session.id === menuId) ?? null : null;
  const menuItems = useMemo<ContextMenuItem[]>(() => {
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
  }, [menuSession, moveItems, t]);

  return <div ref={viewport} className="conversation-sidebar-list scroll-thin" aria-label={t("sidebarList.label")}
    onPointerEnter={event => { setNow(Date.now()); if (event.pointerType !== "touch") setHovering(true); }} onPointerLeave={() => setHovering(false)}>
    {items.length ? <ContextMenu activation="context-only" label={t("session.actions")} items={menuItems}>
      <div ref={inner} className="conversation-sidebar-rows" style={windowed ? { paddingTop: offsets[start], paddingBottom: offsets[items.length] - offsets[end] } : undefined}
        onContextMenuCapture={event => setMenuId((event.target as HTMLElement).closest<HTMLElement>("[data-conversation]")?.dataset.conversation ?? null)}>
        {items.slice(start, end).map(item => item.kind === "project"
          ? <ProjectHeader key={item.key} project={item.project} count={item.count} />
          : <ConversationRow key={item.key} session={item.session} project={item.project} pinned={item.pinned} active={item.session.id === selectedSessionId} status={tabStatus(item.session, unseen, computer)} age={relativeTime(item.session.lastActivityAt, now)} />)}
      </div>
    </ContextMenu> : <p className="conversation-sidebar-empty">{t("sidebarList.empty")}</p>}
    {action ? <SessionActionDialog session={action.session} action={action.kind} onClose={() => setAction(null)} /> : null}
    <SnoozePicker session={snoozing?.session ?? null} anchor={snoozing?.anchor ?? null} onClose={() => setSnoozing(null)} />
  </div>;
}

const ProjectHeader = memo(function ProjectHeader({ project, count }: { project: Project; count: number }) {
  const t = useTranslation();
  return <div className="conversation-group" data-list-kind="project" aria-label={t("sidebarList.projectCount", { project: project.name, count })}>
    <ProjectGlyph project={project} size={13} />
    <span className="conversation-group-name">{project.name}</span>
    <button type="button" className="conversation-group-new" aria-label={t("session.new")} title={t("session.new")} onClick={() => void sidebarProjectAction(project.id, "new")}><SquarePen size={13} aria-hidden="true" /></button>
  </div>;
});

/** Line 1: project and age with the live dot; line 2: the title; line 3: branch and model mark. */
const ConversationRow = memo(function ConversationRow({ session, project, status, active, pinned, age }: { session: Session; project: Project; status: TabStatus; active: boolean; pinned: boolean; age: string }) {
  const t = useTranslation();
  const unread = status === "done" && !active;
  const statusLabel = status === "idle" ? null : unread ? t("sidebarList.unread") : status === "done" ? null : t(`tabs.status.${status}`);
  return <div className="conversation-row" data-list-kind="session" data-conversation={session.id} data-active={active || undefined} data-unread={unread || undefined}>
    <button type="button" className="conversation-row-open" aria-current={active ? "page" : undefined}
      aria-label={[session.title, project.name, statusLabel].filter(Boolean).join(" · ")}
      onPointerDown={event => beginSplitDrag(event, session.id, session.title)}
      onClick={() => void useAppStore.getState().selectSession(session.id)}>
      <span className="conversation-row-meta">
        <ProjectGlyph project={project} size={13} />
        <span className="conversation-row-project">{project.name}</span>
        <span className="conversation-row-age">{age === "now" ? t("Now") : age}</span>
        {statusLabel ? <span className="header-tab-status" data-status={unread ? "unread" : status} aria-hidden="true" /> : null}
      </span>
      <span className="conversation-row-title">{pinned ? <Pin size={11} aria-hidden="true" /> : null}<span>{session.title}</span></span>
      <span className="conversation-row-detail">
        <span className="conversation-row-branch">{session.worktree.branch}</span>
        <ModelIcon modelId={session.model ?? ""} provider={session.agent} size={13} />
      </span>
    </button>
  </div>;
});

