import { formatUnknownError } from "@/lib/format-error";
import { SidebarAstros } from "@/components/astros/SidebarAstros";
import { ProjectGlyph, projectColor } from "@/components/ProjectGlyph";
import { useEffect, useMemo } from "react";
import { Settings } from "@/components/icons/phosphor";
import { SidebarUsageRings } from "@/components/SidebarUsageRings";
import { RailGlyph, SidebarRailMore } from "@/components/SidebarRailMore";
import { RAIL_LABELS, visibleRail } from "@/lib/rail";
import { ArchiveConfirm } from "@/components/SidebarRows";
import { useTranslation } from "@/i18n/use-translation";
import type { SidebarMotion } from "@/lib/sidebar-motion";
import { useGlidingHover } from "@/lib/use-gliding-hover";
import { scheduleProjectDiffs, useAppStore } from "@/store/app-store";
import "@/styles/sidebar.css";

/**
 * The icon rail (ADR-092). The project and session list moved into the header's project
 * switcher; the sidebar toggle now shows or hides this rail. Home returns to the
 * conversation, every other item opens its page.
 */
export function Sidebar({ motion = null }: { motion?: SidebarMotion }) {
  const t = useTranslation();
  const railGlide = useGlidingHover(".sidebar-rail-button");
  const projects = useAppStore(state => state.projects);
  // Edits made outside Sirus (an editor, a terminal) show up when the window comes back.
  useEffect(() => {
    window.addEventListener("focus", scheduleProjectDiffs);
    return () => window.removeEventListener("focus", scheduleProjectDiffs);
  }, []);
  const mainView = useAppStore(state => state.mainView);
  const railItemOrder = useAppStore(state => state.settings.railItemOrder);
  const hiddenRailItems = useAppStore(state => state.settings.hiddenRailItems);
  const railShortcuts = useAppStore(state => state.settings.railProjectShortcuts);
  const selectedProjectId = useAppStore(state => state.selectedProjectId);
  const railItems = useMemo(() => visibleRail(railItemOrder, hiddenRailItems, mainView), [railItemOrder, hiddenRailItems, mainView]);
  const shortcutProjects = useMemo(() => railShortcuts.map(id => projects.find(project => project.id === id)).filter((project): project is NonNullable<typeof project> => !!project), [railShortcuts, projects]);
  const needsYou = useAppStore(state => state.sessions.filter(session => session.status === "waiting" && !session.sideChat && session.id !== state.selectedSessionId).length);
  const current = (id: string) => id === "home" ? mainView === "session" : mainView === id;

  return <aside className="sidebar-material sidebar-shell" aria-label={t("Sidebar")} data-motion={motion ?? undefined}>
    <ArchiveConfirm />
    <div className="titlebar-drag h-[var(--window-controls-height)] shrink-0" />
    <div className="sidebar-layout">
      <div className="sidebar-rail glide-hover-host" aria-label={t("Navigation")} {...railGlide.handlers}>
        {railGlide.pill}
        {railItems.map((id) => <button key={id} type="button" className="sidebar-rail-button" data-section={id} aria-label={t(RAIL_LABELS[id])} title={t(RAIL_LABELS[id])} aria-current={current(id) ? "page" : undefined}
          onClick={() => useAppStore.getState().setMainView(id === "home" ? "session" : id)}>
          <RailGlyph id={id} active={current(id)} />
          {id === "inbox" && needsYou > 0 ? <span className="sidebar-rail-dot" aria-hidden="true" /> : null}
        </button>)}
        {shortcutProjects.length ? <span className="sidebar-rail-divider" aria-hidden="true" /> : null}
        {shortcutProjects.map((project) => <button key={project.id} type="button" className="sidebar-rail-button sidebar-rail-shortcut" aria-label={project.name} title={project.name} aria-current={mainView === "session" && selectedProjectId === project.id ? "page" : undefined}
          onClick={() => { const store = useAppStore.getState(); store.setMainView("session"); void store.selectProject(project.id).catch((error: unknown) => useAppStore.setState({ error: formatUnknownError(error) })); }}>
          {project.look?.logo || project.look?.emoji || project.look?.icon || project.look?.astro ? <ProjectGlyph project={project} size={20} /> : <span className="sidebar-rail-avatar" style={project.look?.color ? { color: projectColor(project.look) } : undefined}>{project.name.trim().charAt(0).toUpperCase() || "?"}</span>}
        </button>)}
        <SidebarAstros onOpen={() => undefined} />
        <SidebarRailMore onOpen={() => undefined} />
        <SidebarUsageRings />
        <button type="button" className="sidebar-rail-button" data-section="settings" aria-label={t("Settings")} title={t("Settings")}
          onClick={() => useAppStore.getState().setSettingsOpen(true)}>
          <Settings size={20} />
        </button>
      </div>
    </div>
  </aside>;
}
