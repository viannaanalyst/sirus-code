import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Archive, ChevronDown, FolderPlus, GitCompareArrows, Pencil, Pin, PinOff, Plus, Search, SquarePen, SquareTerminal, Trash2, X, XCircle, ArrowRight, RotateCcw } from "@/components/icons/phosphor";
import type { Project, Session } from "@/client/types";
import { ProjectActions } from "@/components/ProjectActions";
import { SessionActionDialog } from "@/components/SessionActions";
import { ProjectEditDialog } from "@/components/SidebarRows";
import { relativeTime } from "@/lib/session-board";
import { moveSidebarProject, sidebarGroups, toggleSidebarId } from "@/lib/sidebar-layout";
import { sidebarProjectAction } from "@/lib/sidebar-actions";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { ProjectGlyph } from "@/components/ProjectGlyph";
import { ContextMenu } from "@/components/arc/context-menu/context-menu";
import { useTranslation } from "@/i18n/use-translation";
import { projectStatus, tabStatus, visibleTabSessions, VISIBLE_TABS, type TabStatus } from "@/lib/header-tabs";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/primitives/Dropdown";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { selectCurrentProject, useAppStore, selectListedSessions } from "@/store/app-store";
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

function StatusDot({ status, label }: { status: TabStatus; label?: string }) {
  return status === "idle" ? null : <span className="header-tab-status" data-status={status} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
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
 */
function ProjectSwitcher() {
  const t = useTranslation();
  const project = useAppStore(selectCurrentProject);
  const projects = useAppStore(state => state.projects);
  const sessions = useAppStore(selectListedSessions);
  const settings = useAppStore(state => state.settings);
  const diffs = useAppStore(state => state.projectDiffs);
  const open = useAppStore(state => state.projectSwitcherOpen);
  const setOpen = useAppStore(state => state.setProjectSwitcherOpen);
  const { unseen, computer } = useWaitingSets();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [sessionAction, setSessionAction] = useState<{ session: Session; kind: "rename" | "delete" } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  // Projects reorder by dragging, as they did in the sidebar (pinned and unpinned apart).
  const reorder = usePointerReorder({
    canDrop: (source, target) => settings.pinnedProjectIds.includes(source) === settings.pinnedProjectIds.includes(target),
    onDrop: (source, target, edge) => {
      const state = useAppStore.getState();
      const next = moveSidebarProject(state.projects, state.settings, source, target, edge, state.sessions);
      if (next !== state.settings) void state.saveSettings(next);
    },
  });
  const needle = query.trim().toLocaleLowerCase();
  // Rows cascade in when the switcher opens (ADR-096); filtered results while typing just appear.
  const cascade = useCascade(open) && !needle;
  const groups = useMemo(() => sidebarGroups(projects, sessions, settings), [projects, sessions, settings]);
  const ordered = useMemo(() => [...groups.pinned, ...groups.nested], [groups]);
  const titleMatch = (session: Session) => !needle || session.title.toLocaleLowerCase().includes(needle);
  const rows = useMemo(() => groups.projects.filter(row => !needle || row.name.toLocaleLowerCase().includes(needle)
    || ordered.some(session => session.projectId === row.id && session.title.toLocaleLowerCase().includes(needle))), [groups.projects, ordered, needle]);
  const focused = rows.find(row => row.id === focus) ?? rows.find(row => row.id === project?.id) ?? rows[0] ?? null;
  const pinned = new Set(settings.pinnedSessionIds);
  const shown = focused ? ordered.filter(session => session.projectId === focused.id && (!needle || focused.name.toLocaleLowerCase().includes(needle) || titleMatch(session))) : [];
  // A waiting session in another project is never invisible.
  const elsewhere = projects.some(row => row.id !== project?.id && projectStatus(row.id, sessions, unseen, computer) === "waiting");
  const close = () => { setOpen(false); setQuery(""); setFocus(null); };
  const choose = (id: string) => { close(); void useAppStore.getState().switchProject(id); };
  const openSession = (id: string) => { close(); const store = useAppStore.getState(); store.setMainView("session"); void store.selectSession(id); };
  const newSession = (id: string) => { close(); const store = useAppStore.getState(); void store.switchProject(id).then(() => store.requestNewSession()); };
  const togglePin = (id: string) => { const store = useAppStore.getState(); void store.saveSettings({ ...store.settings, pinnedSessionIds: toggleSidebarId(store.settings.pinnedSessionIds, id) }); };
  const navigate = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = (cursor + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % Math.max(rows.length, 1);
      setCursor(next);
      setFocus(rows[next]?.id ?? null);
    } else if (event.key === "Enter" && rows[cursor]) {
      event.preventDefault();
      choose(rows[cursor].id);
    }
  };
  useEffect(() => { list.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" }); }, [cursor]);
  return <>
  <Popover open={open} onOpenChange={value => { setOpen(value); if (!value) { setQuery(""); setFocus(null); } setCursor(0); }}>
    <PopoverTrigger asChild>
      <button type="button" className="header-project" aria-label={t("tabs.switchProject")}>
        {project ? <ProjectGlyph project={project} size={14} /> : null}
        <span className="truncate">{project?.name ?? "Sirus Code"}</span>
        {elsewhere && <span className="header-tab-status" data-status="waiting" aria-label={t("tabs.waitingElsewhere")} role="img" />}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={8} className="floating-material header-switcher" data-cascade={cascade ? "" : undefined} onOpenAutoFocus={event => { event.preventDefault(); (event.currentTarget as HTMLElement | null)?.querySelector("input")?.focus(); }}>
      <div className="header-switcher-projects">
        <label className="header-switcher-search">
          <Search size={13} aria-hidden="true" />
          <input value={query} placeholder={t("tabs.searchAll")} aria-label={t("tabs.searchAll")} onChange={event => { setQuery(event.target.value); setCursor(0); setFocus(null); }} onKeyDown={navigate} />
        </label>
        <div ref={list} className="header-switcher-list" role="listbox" aria-label={t("tabs.projects")} data-reorder-scope="">
          {rows.map((row, index) => {
            const status = projectStatus(row.id, sessions, unseen, computer);
            const diff = diffs[row.id];
            return <ProjectActions key={row.id} project={row} onEdit={() => { close(); setEditing(row); }}>
              <button type="button" role="option" data-index={index} data-cascade-item="" style={cascadeIndex(index)} aria-selected={row.id === focused?.id} data-current={row.id === project?.id || undefined}
                data-reorder-id={row.id} data-dragging={reorder.dragging === row.id || undefined} data-drop-edge={reorder.over?.id === row.id ? reorder.over.edge : undefined}
                {...(needle || rows.length < 2 ? {} : reorder.bind(row.id))}
                className="header-switcher-row" onMouseEnter={() => { setCursor(index); setFocus(row.id); }} onFocus={() => setFocus(row.id)} onClick={() => choose(row.id)}>
                <ProjectGlyph project={row} size={15} />
                <span className="header-tab-title" onMouseEnter={measureMarquee}><span>{row.name}</span></span>
                <StatusDot status={status} label={t(`tabs.status.${status}`)} />
                <span className="header-switcher-trail">
                  {diff && (diff.additions || diff.deletions) ? <span className="header-switcher-diff"><span data-kind="added">+{diff.additions}</span><span data-kind="removed">-{diff.deletions}</span></span> : null}
                  <span className="header-switcher-actions">
                    {([["review", "Review changes", GitCompareArrows], ["terminal", "New terminal session", SquareTerminal], ["new", "New thread", SquarePen]] as const).map(([kind, label, Icon]) =>
                      <span key={kind} role="button" tabIndex={-1} aria-label={t(label)} title={t(label)} data-no-reorder=""
                        onPointerDown={event => event.stopPropagation()}
                        onClick={event => { event.stopPropagation(); close(); void sidebarProjectAction(row.id, kind); }}><Icon size={13} /></span>)}
                  </span>
                </span>
              </button>
            </ProjectActions>;
          })}
          {!rows.length && <p className="header-switcher-empty">{t("tabs.noProjects")}</p>}
        </div>
        <button type="button" className="header-switcher-footer" data-cascade-item="" style={cascadeIndex(rows.length)} onClick={() => { close(); void useAppStore.getState().addProjectFromPicker(); }}>
          <FolderPlus size={14} aria-hidden="true" />{t("New project")}
        </button>
        <button type="button" className="header-switcher-footer header-switcher-footer-plain" data-cascade-item="" style={cascadeIndex(rows.length + 1)} onClick={() => { close(); useAppStore.getState().setCreateProjectOpen(true); }}>
          <Plus size={14} aria-hidden="true" />{t("newProject.menu")}
        </button>
      </div>
      {focused ? <div className="header-switcher-sessions" aria-label={t("tabs.sessionsOf", { project: focused.name })}>
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
              { id: "delete", label: t("session.delete"), icon: <Trash2 size={15} />, group: "danger", destructive: true, disabled: active, onSelect: () => { close(); setSessionAction({ session, kind: "delete" }); } },
            ]}><div className="header-switcher-session" data-cascade-item="" style={cascadeIndex(index + 1)} data-current={session.id === useAppStore.getState().selectedSessionId || undefined}>
              <button type="button" className="header-switcher-session-open" onClick={() => openSession(session.id)}>
                <ProviderIcon id={session.agent} size={13} className="rounded-none bg-transparent" />
                <span className="header-tab-title" onMouseEnter={measureMarquee}><span>{session.title}</span></span>
                {isPinned ? <Pin size={11} aria-label={t("Pinned")} className="shrink-0 text-text-muted" /> : null}
                <StatusDot status={status} label={t(`tabs.status.${status}`)} />
              </button>
              <span className="header-switcher-trail">
                <span className="header-switcher-time">{time === "now" ? t("Now") : time}</span>
                <span className="header-switcher-actions">
                  <button type="button" aria-label={t(isPinned ? "Unpin session" : "Pin session")} title={t(isPinned ? "Unpin session" : "Pin session")} onClick={() => togglePin(session.id)}>{isPinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
                  <button type="button" aria-label={t("Archive session")} title={t("Archive session")} onClick={() => useAppStore.getState().requestArchive(session.id)}><Archive size={13} /></button>
                </span>
              </span>
            </div></ContextMenu>;
          })}
          {!shown.length && <p className="header-switcher-empty">{t(needle ? "tabs.noSessionsMatch" : "Sessions you start will show up here")}</p>}
        </div>
      </div> : null}
    </PopoverContent>
  </Popover>
  {editing ? <ProjectEditDialog project={editing} open onOpenChange={value => { if (!value) setEditing(null); }} /> : null}
  {sessionAction ? <SessionActionDialog session={sessionAction.session} action={sessionAction.kind} onClose={() => setSessionAction(null)} /> : null}
  </>;
}

/** Header: project switcher plus the project's open session tabs (T1 pills). */
export function HeaderTabs() {
  const t = useTranslation();
  const project = useAppStore(selectCurrentProject);
  const sessions = useAppStore(selectListedSessions);
  const archived = useAppStore(state => state.settings.archivedSessionIds);
  const tabIds = useAppStore(state => (project ? state.openTabsByProject[project.id] : undefined));
  const selectedSessionId = useAppStore(state => state.selectedSessionId);
  const mainView = useAppStore(state => state.mainView);
  const draft = useAppStore(state => (project ? !!state.draftTabByProject[project.id] : false));
  const { unseen, computer } = useWaitingSets();
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
  const tabActionSession = tabAction ? sessions.find(session => session.id === tabAction.id) ?? null : null;
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // One highlight glides to the active tab; first placement and resizes are instant.
  useLayoutEffect(() => {
    const box = list.current, mark = glider.current;
    if (!box || !mark) return;
    const place = (instant: boolean) => {
      // Overflowing titles get the edge fade before any hover.
      box.querySelectorAll<HTMLElement>(".header-tab-title").forEach(title => title.toggleAttribute("data-overflow", (title.firstElementChild?.scrollWidth ?? 0) > title.clientWidth + 2));
      const tab = box.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      mark.toggleAttribute("data-visible", !!tab);
      if (!tab) return;
      mark.toggleAttribute("data-instant", instant);
      mark.style.transform = `translateX(${tab.offsetLeft}px)`;
      mark.style.width = `${tab.offsetWidth}px`;
    };
    place(!placed.current);
    placed.current = true;
    let initial = true;
    const observer = new ResizeObserver(() => { if (initial) initial = false; else place(true); });
    observer.observe(box);
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

  return <div className="header-tabs titlebar-no-drag">
    <ProjectSwitcher />
    <span className="header-tabs-separator" aria-hidden="true">/</span>
    <div className="header-tabs-context">
      <ContextMenu activation="context-only" label={t("tabs.actions")} items={menuTab ? [
        { id: "close", label: t("tabs.close"), icon: <X size={15} />, onSelect: () => close(menuTab) },
        { id: "others", label: t("tabs.closeOthers"), icon: <XCircle size={15} />, disabled: tabs.length < 2, onSelect: () => store().closeOtherHeaderTabs(project.id, menuTab) },
        { id: "right", label: t("tabs.closeRight"), icon: <ArrowRight size={15} />, disabled: tabs.at(-1)?.id === menuTab, onSelect: () => store().closeHeaderTabsToRight(project.id, menuTab) },
        { id: "reopen", label: t("tabs.reopen"), icon: <RotateCcw size={15} />, group: "reopen", disabled: !useAppStore.getState().closedTabs.length, onSelect: () => store().reopenHeaderTab() },
        { id: "rename", label: t("session.rename"), icon: <Pencil size={15} />, group: "session", onSelect: () => setTabAction({ id: menuTab, kind: "rename" }) },
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
            <ProviderIcon id={session.agent} size={13} className="rounded-none bg-transparent" />
            <StatusDot status={status} />
            <span className="header-tab-title" onMouseEnter={measureMarquee}><span>{session.title}</span></span>
            <span className="sr-only">{status !== "idle" ? label(session) : ""}</span>
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
  </div>;
}
