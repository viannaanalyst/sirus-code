import { formatUnknownError } from "@/lib/format-error";
import { ProjectGlyph, projectColor } from "@/components/ProjectGlyph";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { PopoverAnchor } from "@radix-ui/react-popover";
import { NotebookText, PanelLeft, Search, Settings, SquarePen } from "@/components/icons/phosphor";
import { SidebarActivityView } from "@/components/SidebarActivityView";
import { DraftIcon } from "@/components/icons/DraftIcon";
import { SidebarNavigationIcon } from "@/components/icons/SidebarNavigationIcon";
import { SidebarHoverTrack } from "@/components/SidebarHoverTrack";
import { SidebarProjects } from "@/components/SidebarProjects";
import { SidebarUsageRings } from "@/components/SidebarUsageRings";
import { RailGlyph, SidebarRailMore } from "@/components/SidebarRailMore";
import { PAGE_ITEMS, RAIL_LABELS, visibleRail } from "@/lib/rail";
import { SidebarSessionRow, ArchiveConfirm } from "@/components/SidebarRows";
import { SidebarHoverCards } from "@/components/SidebarHoverCard";
import { SidebarPanelHoldContext } from "@/components/SidebarPanelHold";
import { Popover, PopoverContent } from "@/primitives/Popover";
import { IconButton } from "@/primitives/IconButton";
import { useShortcut } from "@/lib/use-shortcut";
import { useTranslation } from "@/i18n/use-translation";
import { initialSidebarPanel, SIDEBAR_RAIL_WIDTH, sidebarActivityFeed, sidebarPanelReducer, type SidebarSection } from "@/lib/sidebar-panels";
import { playSidebarCascade, type SidebarMotion } from "@/lib/sidebar-motion";
import { useGlidingHover } from "@/lib/use-gliding-hover";
import { useAppStore, selectListedSessions } from "@/store/app-store";
import "@/styles/sidebar.css";
import { useDraftOwners } from "@/lib/use-draft-owners";

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
  // The rail's feather filters Home to conversations with unsent drafts.
  const [draftsOnly, setDraftsOnly] = useState(false);
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
  // The rail highlight follows the main view however it changed (palette, board cards, startup).
  const mainView = useAppStore(state => state.mainView);
  const onPage = (PAGE_ITEMS as readonly string[]).includes(mainView);
  const railItemOrder = useAppStore(state => state.settings.railItemOrder);
  const hiddenRailItems = useAppStore(state => state.settings.hiddenRailItems);
  const railShortcuts = useAppStore(state => state.settings.railProjectShortcuts);
  const selectedProjectId = useAppStore(state => state.selectedProjectId);
  const railItems = useMemo(() => visibleRail(railItemOrder, hiddenRailItems, mainView), [railItemOrder, hiddenRailItems, mainView]);
  const shortcutProjects = useMemo(() => railShortcuts.map(id => projects.find(project => project.id === id)).filter((project): project is NonNullable<typeof project> => !!project), [railShortcuts, projects]);
  const needsYou = useAppStore(state => state.sessions.filter(session => session.status === "waiting" && !session.sideChat && session.id !== state.selectedSessionId).length);
  useEffect(() => {
    if (mainView === "kanban" && latest.current.section !== "kanban") dispatch({ type: "select", section: "kanban", collapsed: false });
    else if (mainView !== "kanban" && latest.current.section === "kanban") dispatch({ type: "select", section: "home", collapsed: false });
  }, [mainView]);
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
  // The peek card keeps its last section while it animates out.
  const [lastPeek, setLastPeek] = useState(panel.peek);
  if (panel.peek && panel.peek !== lastPeek) setLastPeek(panel.peek);
  const peekSection = panel.peek ?? lastPeek ?? panel.section;
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
  const renderBody = (floating: boolean, section: typeof peekSection) => <SidebarPanelHoldContext value={hold}><SidebarHoverCards disabled={collapsed}>
    {section !== "home" && section !== "archived" && <div className="sidebar-panel-header">
      <h1 className="ui-brand truncate min-w-0 flex-1">{t(sections.find(item => item.id === section)!.label)}</h1>
      {floating && <IconButton label={t("Pin sidebar")} tooltip={false} onClick={pin} className="sidebar-header-action"><PanelLeft size={13} /></IconButton>}
    </div>}
    {section === "home" || section === "archived" ? <SidebarActivity key={section} archived={section === "archived"} floating={floating} onPin={pin} draftsOnly={draftsOnly} /> : <div className="scroll-thin sidebar-section-body"><p className="ui-caption text-text-muted">{t("Projects")}</p>{projects.map(project => <button key={project.id} className="sidebar-menu-row sidebar-panel-link" onClick={() => { void useAppStore.getState().selectProject(project.id).then(() => useAppStore.getState().setMainView("kanban")).catch((error: unknown) => useAppStore.setState({ error: formatUnknownError(error) })); }}><SidebarNavigationIcon section="kanban"/><span>{project.name}</span></button>)}<button className="sidebar-menu-row sidebar-panel-link" onClick={() => useAppStore.getState().setMainView("kanban")}><SidebarNavigationIcon section="kanban"/><span>{t("Kanban")}</span></button></div>}
  </SidebarHoverCards></SidebarPanelHoldContext>;

  return <aside className="sidebar-material sidebar-shell" aria-label={t("Sidebar")}>
    <ArchiveConfirm />
    <div className="titlebar-drag h-[var(--window-controls-height)] shrink-0" />
    <Popover open={collapsed && panel.peek !== null} onOpenChange={open => { if (!open) dismiss(); }}>
      <div className="sidebar-layout">
        <PopoverAnchor virtualRef={trigger} />
        <div ref={rail} className="sidebar-rail glide-hover-host" data-page={onPage || undefined} aria-label={t("Navigation")} {...railGlide.handlers} onPointerEnter={enter} onPointerLeave={leave} onPointerMove={() => { keyboard.current = false; }} onKeyDownCapture={() => { keyboard.current = true; }} onBlur={leave}>
          {railGlide.pill}
          {railItems.map((id) => {
            if (id === "home" || id === "kanban" || id === "archived") {
              const label = sections.find((item) => item.id === id)!.label;
              return <button key={id} type="button" className="sidebar-rail-button" data-section={id} aria-label={t(label)} title={collapsed ? undefined : t(label)} aria-expanded={collapsed ? panel.peek === id : panel.section === id} aria-controls={collapsed ? (panel.peek === id ? "sidebar-peek" : undefined) : "sidebar-docked"} aria-current={section === id && !onPage ? "page" : undefined}
                onPointerEnter={event => peek(id, event.currentTarget)} onFocus={event => { if (!suppressFocus.current) { keyboard.current = event.currentTarget.matches(":focus-visible"); peek(id, event.currentTarget); } }}
                onClick={event => {
                  if (held.current.size) return;
                  trigger.current = event.currentTarget; dispatch({ type: "select", section: id, collapsed });
                  // The Kanban icon opens the board itself; Home returns to the conversation.
                  const store = useAppStore.getState();
                  if (id === "kanban") store.setMainView("kanban");
                  else if (id === "home" && store.mainView !== "session") store.setMainView("session");
                }}
                onKeyDown={event => { if (event.key === "ArrowRight" && collapsed) { event.preventDefault(); peek(id, event.currentTarget); requestAnimationFrame(() => content.current?.querySelector<HTMLButtonElement>("button")?.focus()); } if (event.key === "Escape") { event.preventDefault(); dismiss(); } }}><RailGlyph id={id} active={section === id && !onPage} /></button>;
            }
            if (id === "drafts") return <button key={id} type="button" className="sidebar-rail-button sidebar-rail-drafts" data-section="drafts" aria-pressed={draftsOnly}
              aria-label={t(draftsOnly ? "Show all conversations" : "Show only conversations with drafts")} title={t(draftsOnly ? "Show all conversations" : "Show only conversations with drafts")}
              onPointerEnter={() => dismiss()} onFocus={() => dismiss()}
              onClick={event => { const next = !draftsOnly; setDraftsOnly(next); if (next && !held.current.size) { trigger.current = event.currentTarget; dispatch({ type: "select", section: "home", collapsed }); } }}>
              <DraftIcon size={20} />
            </button>;
            return <button key={id} type="button" className="sidebar-rail-button" data-section={id} aria-label={t(RAIL_LABELS[id])} title={t(RAIL_LABELS[id])} aria-current={mainView === id ? "page" : undefined}
              onPointerEnter={() => dismiss()} onFocus={() => dismiss()}
              onClick={() => { cancelClose(); dispatch({ type: "dismiss" }); useAppStore.getState().setMainView(id); }}>
              <RailGlyph id={id} active={mainView === id} />
              {id === "inbox" && needsYou > 0 ? <span className="sidebar-rail-dot" aria-hidden="true" /> : null}
            </button>;
          })}
          {shortcutProjects.length ? <span className="sidebar-rail-divider" aria-hidden="true" /> : null}
          {shortcutProjects.map((project) => <button key={project.id} type="button" className="sidebar-rail-button sidebar-rail-shortcut" aria-label={project.name} title={project.name} aria-current={mainView === "session" && selectedProjectId === project.id ? "page" : undefined}
            onPointerEnter={() => dismiss()} onFocus={() => dismiss()}
            onClick={() => { cancelClose(); dispatch({ type: "select", section: "home", collapsed: false }); const store = useAppStore.getState(); store.setMainView("session"); void store.selectProject(project.id).catch((error: unknown) => useAppStore.setState({ error: formatUnknownError(error) })); }}>
            {project.look?.logo || project.look?.emoji ? <ProjectGlyph project={project} size={20} /> : <span className="sidebar-rail-avatar" style={project.look?.color ? { color: projectColor(project.look) } : undefined}>{project.name.trim().charAt(0).toUpperCase() || "?"}</span>}
          </button>)}
          <SidebarRailMore onOpen={() => { cancelClose(); dispatch({ type: "dismiss" }); }} />
          <SidebarUsageRings />
          <button type="button" className="sidebar-rail-button" data-section="settings" aria-label={t("Settings")} title={t("Settings")}
            onPointerEnter={() => dismiss()} onFocus={() => dismiss()}
            onClick={() => { cancelClose(); dispatch({ type: "dismiss" }); useAppStore.getState().setSettingsOpen(true); }}>
            <Settings size={20} />
          </button>
        </div>
        {docked && <div id="sidebar-docked" className="sidebar-docked-panel" ref={dockedRef} data-closing={motion === "closing" || undefined} inert={motion === "closing"} style={{ minWidth: sidebarWidth - SIDEBAR_RAIL_WIDTH }}>{renderBody(false, section)}</div>}
      </div>
      {collapsed && <PopoverContent id="sidebar-peek" ref={peekRef} side="right" align="start" sideOffset={18} alignOffset={-8} collisionPadding={8} data-glide={glide || undefined} className="floating-material sidebar-peek-panel" aria-label={t(sections.find(item => item.id === peekSection)!.label)}
        onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
        onEscapeKeyDown={event => { if (held.current.size) { event.preventDefault(); return; } event.preventDefault(); dismiss(true); }}
        onInteractOutside={event => { if (held.current.size || (event.target instanceof Node && rail.current?.contains(event.target))) event.preventDefault(); }}
        onPointerEnter={enter} onPointerLeave={leave} onPointerMove={() => { keyboard.current = false; }} onKeyDownCapture={() => { keyboard.current = true; }} onFocus={cancelClose} onBlur={closeSoon}>{renderBody(true, peekSection)}</PopoverContent>}
    </Popover>
  </aside>;
}

function SidebarActivity({ archived, floating, onPin, draftsOnly }: { archived: boolean; floating: boolean; onPin: () => void; draftsOnly: boolean }) {
  const t = useTranslation();
  const shortcut = useShortcut("new-session");
  const projects = useAppStore(state => state.projects);
  const sessions = useAppStore(selectListedSessions);
  const drafts = useDraftOwners();
  const settings = useAppStore(state => state.settings);
  const selectedSessionId = useAppStore(state => state.selectedSessionId);
  const mainView = useAppStore(state => state.mainView);
  const activityView = settings.sidebarActivityView;
  const unread = useAppStore(state => state.unseenSessionIds.some(id => id !== state.selectedSessionId));
  const groups = useMemo(() => sidebarActivityFeed(projects, sessions, settings, drafts, { archived, draftsOnly: !archived && draftsOnly }), [projects, sessions, settings, drafts, archived, draftsOnly]);
  const total = groups.reduce((sum, group) => sum + group.sessions.length, 0);
  return <>
    <div className="sidebar-panel-header">
      {archived ? <h1 className="ui-brand truncate min-w-0 flex-1">{t("Archived sessions")}</h1>
        : <h1 className="sidebar-brand ui-brand min-w-0 flex-1"><img src="/switchyard-glyph.png" alt="" draggable={false} /><span className="truncate">Switchyard</span></h1>}
      <IconButton label={t("palette.searchChats")} tooltip={false} onClick={() => useAppStore.getState().setPaletteOpen(true)} className="sidebar-header-action"><Search size={14} /></IconButton>
      {!archived && <IconButton label={t(activityView ? "activity.showClassic" : "activity.showActivity")} tooltip={false} aria-pressed={activityView} style={activityView ? { background: "color-mix(in srgb, var(--info) 15%, transparent)", color: "var(--info)" } : undefined} onClick={() => { const store = useAppStore.getState(); void store.saveSettings({ ...store.settings, sidebarActivityView: !activityView }); }} className="sidebar-header-action sidebar-activity-toggle"><NotebookText size={14} />{unread && <span className="sidebar-activity-dot" aria-hidden="true" />}</IconButton>}
      {floating && <IconButton label={t("Pin sidebar")} tooltip={false} onClick={onPin} className="sidebar-header-action"><PanelLeft size={13} /></IconButton>}
    </div>
    <SidebarHoverTrack className="flex min-h-0 flex-1 flex-col">
    {!archived && <button data-new-session type="button" className="sidebar-menu-row sidebar-new-thread" onClick={() => useAppStore.getState().requestNewSession()}><SquarePen size={14} /><span>{t("New thread")}</span><kbd>{shortcut}</kbd></button>}
    {!archived ? (activityView ? <SidebarActivityView floating={floating} draftsOnly={draftsOnly} /> : <SidebarProjects floating={floating} draftsOnly={draftsOnly} />) : <div className="scroll-thin sidebar-activity-list">{groups.map(group => group.sessions.length > 0 && <section key={group.label} aria-label={t(group.label)}><p className="sidebar-section-label ui-caption">{t(group.label)}</p>{group.sessions.map(session => <SidebarSessionRow key={session.id} session={session} project={projects.find(project => project.id === session.projectId)} active={mainView === "session" && selectedSessionId === session.id} archived={archived} />)}</section>)}{total === 0 && <p className="px-2 py-3 ui-caption text-text-muted">{t(archived ? "No archived sessions" : "No sessions in this view")}</p>}</div>}
    </SidebarHoverTrack>

  </>;
}
