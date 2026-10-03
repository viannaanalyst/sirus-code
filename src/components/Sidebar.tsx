import { formatUnknownError } from "@/lib/format-error";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { PopoverAnchor } from "@radix-ui/react-popover";
import { NotebookPen, PanelLeft, Search, Settings, SquarePen } from "lucide-react";
import { SidebarNavigationIcon } from "@/components/icons/SidebarNavigationIcon";
import { SidebarHoverTrack } from "@/components/SidebarHoverTrack";
import { SidebarProjects } from "@/components/SidebarProjects";
import { SidebarSessionRow } from "@/components/SidebarRows";
import { SidebarHoverCards } from "@/components/SidebarHoverCard";
import { SidebarPanelHoldContext } from "@/components/SidebarPanelHold";
import { Popover, PopoverContent } from "@/primitives/Popover";
import { IconButton } from "@/primitives/IconButton";
import { Input } from "@/components/arc/input/input";
import { useShortcut } from "@/lib/use-shortcut";
import { useTranslation } from "@/i18n/use-translation";
import { initialSidebarPanel, SIDEBAR_RAIL_WIDTH, sidebarActivityFeed, sidebarPanelReducer, type SidebarSection } from "@/lib/sidebar-panels";
import { playSidebarCascade, type SidebarMotion } from "@/lib/sidebar-motion";
import { useGlidingHover } from "@/lib/use-gliding-hover";
import { useAppStore } from "@/store/app-store";
import "@/styles/sidebar.css";

const sections = [
  { id: "home", label: "Home" },
  { id: "kanban", label: "Kanban" },
  { id: "archived", label: "Archived sessions" },
] as const;

export function Sidebar({ motion = null }: { motion?: SidebarMotion }) {
  const t = useTranslation();
  const collapsed = useAppStore(state => state.sidebarCollapsed);
  const sidebarWidth = useAppStore(state => state.sidebarWidth);
  const [glide, setGlide] = useState(false);
  const railGlide = useGlidingHover(".sidebar-rail-button");
  const toggleSidebar = useAppStore(state => state.toggleSidebar);
  const projects = useAppStore(state => state.projects);
  const [panel, dispatch] = useReducer(sidebarPanelReducer, initialSidebarPanel);
  const rail = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inside = useRef(false);
  const keyboard = useRef(false);
  const suppressFocus = useRef(false);
  const held = useRef(new Set<string>());
  const latest = useRef(panel);
  useEffect(() => { latest.current = panel; }, [panel]);
  const cancelClose = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; }, []);
  const closeSoon = useCallback(() => {
    cancelClose();
    const revision = latest.current.revision;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (inside.current || held.current.size || (keyboard.current && (content.current?.contains(document.activeElement) || rail.current?.contains(document.activeElement)))) return;
      dispatch({ type: "leave", revision });
    }, 180);
  }, [cancelClose]);
  const hold = useCallback((id: string, open: boolean) => {
    if (open) { held.current.add(id); cancelClose(); }
    else { held.current.delete(id); if (!inside.current) closeSoon(); }
  }, [cancelClose, closeSoon]);
  useEffect(() => () => cancelClose(), [cancelClose]);
  // A shortcut or Settings can collapse the sidebar independently of this rail.
  useEffect(() => { cancelClose(); dispatch({ type: "dismiss" }); }, [collapsed, cancelClose]);
  const enter = () => { inside.current = true; cancelClose(); };
  const leave = () => { inside.current = false; closeSoon(); };
  const peek = (section: SidebarSection, button: HTMLButtonElement) => {
    if (held.current.size) return;
    trigger.current = button;
    // Moving between rail icons glides the open panel; a fresh open springs in place.
    if (collapsed) { cancelClose(); setGlide(latest.current.peek !== null); dispatch({ type: "peek", section }); }
  };
  const dismiss = (restoreFocus = false) => {
    if (held.current.size) return;
    cancelClose(); dispatch({ type: "dismiss" });
    if (restoreFocus) { suppressFocus.current = true; trigger.current?.focus(); suppressFocus.current = false; }
  };
  const section = collapsed ? panel.peek ?? panel.section : panel.section;
  const pin = () => {
    cancelClose(); dispatch({ type: "pin" });
    if (collapsed) toggleSidebar();
    else { dispatch({ type: "dismiss" }); toggleSidebar(); }
    // The floating control unmounts. Return focus to the persistent rail.
    const returnTarget = trigger.current ?? rail.current?.querySelector<HTMLButtonElement>(`[data-section="${section}"]`);
    suppressFocus.current = true; returnTarget?.focus(); suppressFocus.current = false;
  };
  const docked = !collapsed || motion === "closing";
  const opening = motion === "opening";
  const dockedRef = useCallback((node: HTMLDivElement | null) => { content.current = node; if (node && opening) playSidebarCascade(node); }, [opening]);
  const peekRef = useCallback((node: HTMLDivElement | null) => { content.current = node; if (node && section) playSidebarCascade(node); }, [section]);
  const renderBody = (floating: boolean) => <SidebarPanelHoldContext value={hold}><SidebarHoverCards disabled={collapsed}>
    {section !== "home" && section !== "archived" && <div className="sidebar-panel-header">
      <h1 className="ui-brand truncate min-w-0 flex-1">{t(sections.find(item => item.id === section)!.label)}</h1>
      {floating && <IconButton label={t("Pin sidebar")} tooltip={false} onClick={pin} className="sidebar-header-action"><PanelLeft size={13} /></IconButton>}
    </div>}
    {section === "home" || section === "archived" ? <SidebarActivity key={section} archived={section === "archived"} floating={floating} onPin={pin} /> : <div className="scroll-thin sidebar-section-body"><p className="ui-caption text-text-muted">{t("Projects")}</p>{projects.map(project => <button key={project.id} className="sidebar-menu-row sidebar-panel-link" onClick={() => { void useAppStore.getState().selectProject(project.id).then(() => useAppStore.getState().setMainView("kanban")).catch((error: unknown) => useAppStore.setState({ error: formatUnknownError(error) })); }}><SidebarNavigationIcon section="kanban"/><span>{project.name}</span></button>)}<button className="sidebar-menu-row sidebar-panel-link" onClick={() => useAppStore.getState().setMainView("kanban")}><SidebarNavigationIcon section="kanban"/><span>{t("Kanban")}</span></button></div>}
  </SidebarHoverCards></SidebarPanelHoldContext>;

  return <aside className="sidebar-material sidebar-shell" aria-label={t("Sidebar")}>
    <div className="titlebar-drag h-[var(--window-controls-height)] shrink-0" />
    <Popover open={collapsed && panel.peek !== null} onOpenChange={open => { if (!open) dismiss(); }}>
      <div className="sidebar-layout">
        <PopoverAnchor virtualRef={trigger} />
        <div ref={rail} className="sidebar-rail glide-hover-host" aria-label={t("Navigation")} {...railGlide.handlers} onPointerEnter={enter} onPointerLeave={leave} onPointerMove={() => { keyboard.current = false; }} onKeyDownCapture={() => { keyboard.current = true; }} onBlur={leave}>
          {railGlide.pill}
          {sections.map(({ id, label }) => <button key={id} type="button" className="sidebar-rail-button" data-section={id} aria-label={t(label)} title={collapsed ? undefined : t(label)} aria-expanded={collapsed ? panel.peek === id : panel.section === id} aria-controls={collapsed ? (panel.peek === id ? "sidebar-peek" : undefined) : "sidebar-docked"} aria-current={section === id ? "page" : undefined}
            onPointerEnter={event => peek(id, event.currentTarget)} onFocus={event => { if (!suppressFocus.current) { keyboard.current = event.currentTarget.matches(":focus-visible"); peek(id, event.currentTarget); } }}
            onClick={event => { if (held.current.size) return; trigger.current = event.currentTarget; dispatch({ type: "select", section: id, collapsed }); }}
            onKeyDown={event => { if (event.key === "ArrowRight" && collapsed) { event.preventDefault(); peek(id, event.currentTarget); requestAnimationFrame(() => content.current?.querySelector<HTMLButtonElement>("button")?.focus()); } if (event.key === "Escape") { event.preventDefault(); dismiss(); } }}><SidebarNavigationIcon section={id} filled={section === id}/></button>)}
          <button type="button" className="sidebar-rail-button" data-section="settings" aria-label={t("Settings")} title={t("Settings")}
            onPointerEnter={() => dismiss()} onFocus={() => dismiss()}
            onClick={() => { cancelClose(); dispatch({ type: "dismiss" }); useAppStore.getState().setSettingsOpen(true); }}>
            <Settings size={14} strokeWidth={1.6} />
          </button>
        </div>
        {docked && <div id="sidebar-docked" className="sidebar-docked-panel" ref={dockedRef} data-closing={motion === "closing" || undefined} inert={motion === "closing"} style={{ minWidth: sidebarWidth - SIDEBAR_RAIL_WIDTH }}>{renderBody(false)}</div>}
      </div>
      {collapsed && panel.peek && <PopoverContent id="sidebar-peek" ref={peekRef} side="right" align="start" sideOffset={18} alignOffset={-8} collisionPadding={8} data-glide={glide || undefined} className="floating-material sidebar-peek-panel" aria-label={t(sections.find(item => item.id === section)!.label)}
        onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
        onEscapeKeyDown={event => { if (held.current.size) { event.preventDefault(); return; } event.preventDefault(); dismiss(true); }}
        onInteractOutside={event => { if (held.current.size || (event.target instanceof Node && rail.current?.contains(event.target))) event.preventDefault(); }}
        onPointerEnter={enter} onPointerLeave={leave} onPointerMove={() => { keyboard.current = false; }} onKeyDownCapture={() => { keyboard.current = true; }} onFocus={cancelClose} onBlur={closeSoon}>{renderBody(true)}</PopoverContent>}
    </Popover>
  </aside>;
}

function SidebarActivity({ archived, floating, onPin }: { archived: boolean; floating: boolean; onPin: () => void }) {
  const t = useTranslation();
  const shortcut = useShortcut("new-session");
  const projects = useAppStore(state => state.projects);
  const sessions = useAppStore(state => state.sessions);
  const drafts = useAppStore(state => state.composerDrafts);
  const settings = useAppStore(state => state.settings);
  const selectedSessionId = useAppStore(state => state.selectedSessionId);
  const mainView = useAppStore(state => state.mainView);
  const selectedProjectId = useAppStore(state => state.selectedProjectId);
  const [draftsOnly, setDraftsOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState(false);
  const groups = useMemo(() => sidebarActivityFeed(projects, sessions, settings, drafts, { archived, draftsOnly: !archived && draftsOnly, query }), [projects, sessions, settings, drafts, archived, draftsOnly, query]);
  const total = groups.reduce((sum, group) => sum + group.sessions.length, 0);
  return <>
    <div className="sidebar-panel-header">
      <h1 className="ui-brand truncate min-w-0 flex-1">{archived ? t("Archived sessions") : projects.find(project => project.id === selectedProjectId)?.name ?? "Switchyard"}</h1>
      <IconButton label={t("Search sessions")} tooltip={false} aria-expanded={search} onClick={() => { setSearch(!search); if (search) setQuery(""); }} className="sidebar-header-action"><Search size={13} /></IconButton>
      {!archived && <IconButton label={t("Drafts")} tooltip={false} aria-pressed={draftsOnly} onClick={() => setDraftsOnly(!draftsOnly)} className="sidebar-header-action"><NotebookPen size={13} /></IconButton>}
      {floating && <IconButton label={t("Pin sidebar")} tooltip={false} onClick={onPin} className="sidebar-header-action"><PanelLeft size={13} /></IconButton>}
    </div>
    <SidebarHoverTrack className="flex min-h-0 flex-1 flex-col">
    {!archived && <button data-new-session type="button" className="sidebar-menu-row sidebar-new-thread" onClick={() => useAppStore.getState().requestNewSession()}><SquarePen size={14} /><span>{t("New thread")}</span><kbd>{shortcut}</kbd></button>}
    {search && <div className="px-2 pb-2"><Input autoFocus type="search" label={t("Search sessions")} value={query} onChange={event => setQuery(event.target.value)} /></div>}
    {!archived ? <SidebarProjects floating={floating} query={query} draftsOnly={draftsOnly} /> : <div className="scroll-thin sidebar-activity-list">{groups.map(group => group.sessions.length > 0 && <section key={group.label} aria-label={t(group.label)}><p className="sidebar-section-label ui-caption">{t(group.label)}</p>{group.sessions.map(session => <SidebarSessionRow key={session.id} session={session} project={projects.find(project => project.id === session.projectId)} active={mainView === "session" && selectedSessionId === session.id} archived={archived} />)}</section>)}{total === 0 && <p className="px-2 py-3 ui-caption text-text-muted">{t(archived ? "No archived sessions" : "No sessions in this view")}</p>}</div>}
    </SidebarHoverTrack>

  </>;
}
