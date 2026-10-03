import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { ChevronDown, FolderPlus, Plus, Search, X } from "lucide-react";
import type { Session } from "@/client/types";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { ContextMenu } from "@/components/arc/context-menu/context-menu";
import { useTranslation } from "@/i18n/use-translation";
import { projectStatus, tabStatus, visibleTabSessions, VISIBLE_TABS, type TabStatus } from "@/lib/header-tabs";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/primitives/Dropdown";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { selectCurrentProject, useAppStore, selectSessionsMeta } from "@/store/app-store";
import "@/styles/header-tabs.css";

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

/** Project title in the header; opens a searchable switcher with each project's live status. */
function ProjectSwitcher() {
  const t = useTranslation();
  const project = useAppStore(selectCurrentProject);
  const projects = useAppStore(state => state.projects);
  const sessions = useAppStore(selectSessionsMeta);
  const tabs = useAppStore(state => state.openTabsByProject);
  const open = useAppStore(state => state.projectSwitcherOpen);
  const setOpen = useAppStore(state => state.setProjectSwitcherOpen);
  const { unseen, computer } = useWaitingSets();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return [...projects]
      .sort((a, b) => Number(b.id === project?.id) - Number(a.id === project?.id) || b.lastOpenedAt.localeCompare(a.lastOpenedAt))
      .filter(row => !needle || row.name.toLocaleLowerCase().includes(needle));
  }, [projects, project?.id, query]);
  // A waiting session in another project is never invisible.
  const elsewhere = projects.some(row => row.id !== project?.id && projectStatus(row.id, sessions, unseen, computer) === "waiting");
  const choose = (id: string) => { setQuery(""); void useAppStore.getState().switchProject(id); };
  const navigate = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setCursor(index => (index + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % Math.max(rows.length, 1));
    } else if (event.key === "Enter" && rows[cursor]) {
      event.preventDefault();
      choose(rows[cursor].id);
    }
  };
  useEffect(() => { list.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" }); }, [cursor]);
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (!value) setQuery(""); setCursor(0); }}>
    <PopoverTrigger asChild>
      <button type="button" className="header-project" aria-label={t("tabs.switchProject")}>
        <span className="truncate">{project?.name ?? "Switchyard"}</span>
        {elsewhere && <span className="header-tab-status" data-status="waiting" aria-label={t("tabs.waitingElsewhere")} role="img" />}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={8} className="floating-material header-switcher" onOpenAutoFocus={event => { event.preventDefault(); (event.currentTarget as HTMLElement | null)?.querySelector("input")?.focus(); }}>
      <label className="header-switcher-search">
        <Search size={13} aria-hidden="true" />
        <input value={query} placeholder={t("tabs.searchProjects")} aria-label={t("tabs.searchProjects")} onChange={event => { setQuery(event.target.value); setCursor(0); }} onKeyDown={navigate} />
      </label>
      <div ref={list} className="header-switcher-list" role="listbox" aria-label={t("tabs.projects")}>
        {rows.map((row, index) => {
          const status = projectStatus(row.id, sessions, unseen, computer);
          const count = (tabs[row.id] ?? []).length;
          return <button key={row.id} type="button" role="option" data-index={index} aria-selected={index === cursor} data-current={row.id === project?.id || undefined}
            className="header-switcher-row" onMouseEnter={() => setCursor(index)} onClick={() => choose(row.id)}>
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            <StatusDot status={status} label={t(`tabs.status.${status}`)} />
            {count > 0 && <span className="header-switcher-count">{t(count === 1 ? "tabs.countOne" : "tabs.count", { count })}</span>}
          </button>;
        })}
        {!rows.length && <p className="header-switcher-empty">{t("tabs.noProjects")}</p>}
      </div>
      <button type="button" className="header-switcher-footer" onClick={() => { setOpen(false); void useAppStore.getState().addProjectFromPicker(); }}>
        <FolderPlus size={14} aria-hidden="true" />{t("New project")}
      </button>
    </PopoverContent>
  </Popover>;
}

/** Collapsed-sidebar header: project switcher plus the project's open session tabs (T1 pills). */
export function HeaderTabs() {
  const t = useTranslation();
  const project = useAppStore(selectCurrentProject);
  const sessions = useAppStore(selectSessionsMeta);
  const archived = useAppStore(state => state.settings.archivedSessionIds);
  const tabIds = useAppStore(state => (project ? state.openTabsByProject[project.id] : undefined));
  const selectedSessionId = useAppStore(state => state.selectedSessionId);
  const mainView = useAppStore(state => state.mainView);
  const { unseen, computer } = useWaitingSets();
  const tabs = useMemo(() => (project ? visibleTabSessions(tabIds ?? [], sessions, project.id, archived) : []), [project, tabIds, sessions, archived]);
  const shown = tabs.slice(0, VISIBLE_TABS);
  const overflow = tabs.slice(VISIBLE_TABS);
  const draft = useAppStore(state => (project ? !!state.draftTabByProject[project.id] : false));
  const defaultAgent = useAppStore(state => state.settings.defaultAgent);
  const onDraft = mainView === "session" && !selectedSessionId;
  const active = mainView === "session" ? selectedSessionId : null;
  const shownKey = `${shown.map(tab => tab.id).join()}|${draft}|${onDraft}`;
  const list = useRef<HTMLDivElement>(null);
  const glider = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const dragId = useRef<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [menuTab, setMenuTab] = useState<string | null>(null);
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
    <ContextMenu activation="context-only" label={t("tabs.actions")} items={menuTab ? [
      { id: "close", label: t("tabs.close"), onSelect: () => close(menuTab) },
      { id: "others", label: t("tabs.closeOthers"), disabled: tabs.length < 2, onSelect: () => store().closeOtherHeaderTabs(project.id, menuTab) },
      { id: "right", label: t("tabs.closeRight"), disabled: tabs.at(-1)?.id === menuTab, onSelect: () => store().closeHeaderTabsToRight(project.id, menuTab) },
      { id: "reopen", label: t("tabs.reopen"), disabled: !useAppStore.getState().closedTabs.length, onSelect: () => store().reopenHeaderTab() },
    ] : []}>
      <div ref={list} className="header-tabs-list" role="tablist" aria-label={t("tabs.label")}
        onContextMenuCapture={event => setMenuTab((event.target as HTMLElement).closest<HTMLElement>("[data-tab]")?.dataset.tab ?? null)}>
        <span ref={glider} className="header-tabs-glider" aria-hidden="true" />
        {shown.map((session, index) => {
          const status = tabStatus(session, unseen, computer);
          return <div key={session.id} role="tab" tabIndex={session.id === active ? 0 : -1} aria-selected={session.id === active} data-tab={session.id}
            data-leaving={leaving === session.id || undefined} draggable title={`${session.title}${index < 9 ? `  ⌘${index + 1}` : ""}`}
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
            }}
            onDragStart={event => { dragId.current = session.id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-switchyard-tab", session.id); }}
            onDragOver={event => { if (dragId.current && dragId.current !== session.id) { event.preventDefault(); store().moveHeaderTab(project.id, dragId.current, session.id); } }}
            onDragEnd={() => { dragId.current = null; }}>
            <ProviderIcon id={session.agent} size={13} className="rounded-none bg-transparent" />
            <StatusDot status={status} />
            <span className="header-tab-title" onMouseEnter={measureMarquee}><span>{session.title}</span></span>
            <span className="sr-only">{status !== "idle" ? label(session) : ""}</span>
            <button type="button" className="header-tab-close" tabIndex={-1} aria-label={t("tabs.closeNamed", { title: session.title })} onClick={event => { event.stopPropagation(); close(session.id); }}><X size={11} aria-hidden="true" /></button>
          </div>;
        })}
        {draft && <div role="tab" tabIndex={onDraft ? 0 : -1} aria-selected={onDraft} data-draft className="header-tab" style={{ "--tab-index": shown.length } as CSSProperties}
          onClick={() => { if (!onDraft) store().requestNewSession(); }}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); store().requestNewSession(); } }}>
          <ProviderIcon id={defaultAgent} size={13} className="rounded-none bg-transparent" />
          <span className="header-tab-title"><span>{t("session.new")}</span></span>
          {(tabs.length > 0 || !onDraft) && <button type="button" className="header-tab-close" tabIndex={-1} aria-label={t("tabs.closeNamed", { title: t("session.new") })} onClick={event => { event.stopPropagation(); store().closeDraftTab(project.id); }}><X size={11} aria-hidden="true" /></button>}
        </div>}
      </div>
    </ContextMenu>
    {overflow.length > 0 && <Dropdown>
      <DropdownTrigger asChild><button type="button" className="header-tabs-more" aria-label={t("tabs.more", { count: overflow.length })}>+{overflow.length}</button></DropdownTrigger>
      <DropdownContent align="end">
        {overflow.map(session => <DropdownItem key={session.id} onSelect={() => void store().selectSession(session.id)}>{session.title}</DropdownItem>)}
      </DropdownContent>
    </Dropdown>}
    <button type="button" className="header-tabs-new" aria-label={t("session.new")} title={t("session.new")} onClick={() => store().requestNewSession()}><Plus size={14} aria-hidden="true" /></button>
    {toast && <div className="header-tabs-toast" role="status">
      <span>{t("tabs.closedToast", { title: toastTitle })}</span>
      <button type="button" onClick={() => { setToast(null); store().reopenHeaderTab(); }}>{t("tabs.undo")}</button>
    </div>}
  </div>;
}
