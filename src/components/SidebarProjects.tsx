import { nestTeamSessions } from "@/lib/team";
import "@/styles/team.css";
import { useSidebarPanelHold } from "@/components/SidebarPanelHold";
import { SidebarHoverCards } from "@/components/SidebarHoverCard";
import { useMemo, useState } from "react";
import { FolderHero } from "@/components/FolderHero";
import { NewSessionButton } from "@/components/NewSessionButton";
import { SidebarProjectRow, SidebarSessionRow } from "@/components/SidebarRows";
import { SidebarDisclosure, SidebarWindowedRows } from "@/components/SidebarWindow";
import { moveSidebarProject, sidebarGroups } from "@/lib/sidebar-layout";
import { formatUnknownError } from "@/lib/format-error";
import { usePointerReorder, type DropEdge } from "@/lib/use-pointer-reorder";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore, selectListedSessions } from "@/store/app-store";
import { useDraftOwners } from "@/lib/use-draft-owners";

export function SidebarProjects({ floating = false, query = "", draftsOnly = false }: { floating?: boolean; query?: string; draftsOnly?: boolean }) {
  const t = useTranslation();
  const projects = useAppStore(state => state.projects);
  const selectedProjectId = useAppStore(state => state.selectedProjectId);
  const selectedSessionId = useAppStore(state => state.selectedSessionId);
  const sessions = useAppStore(selectListedSessions);
  const settings = useAppStore(state => state.settings);
  const drafts = useDraftOwners();
  const groups = useMemo(() => {
    const catalog = sidebarGroups(projects, sessions, settings);
    const search = query.trim().toLocaleLowerCase();
    const visible = (session: (typeof sessions)[number]) => (!draftsOnly || !!drafts[`session:${session.id}`]?.trim())
      && (!search || `${session.title} ${projects.find(project => project.id === session.projectId)?.name ?? ""} ${session.worktree.branch}`.toLocaleLowerCase().includes(search));
    const pinned = catalog.pinned.filter(visible), nested = catalog.nested.filter(visible);
    return { ...catalog, pinned, nested, projects: catalog.projects.filter(project => ((!search && !draftsOnly) || [...pinned, ...nested].some(session => session.projectId === project.id))) };
  }, [projects, sessions, settings, drafts, query, draftsOnly]);
  const selectProject = useAppStore(state => state.selectProject);
  const requestNewSession = useAppStore(state => state.requestNewSession);
  const mainView = useAppStore(state => state.mainView);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});


  const persistMove = (id: string, targetId: string, edge: DropEdge) => {
    const state = useAppStore.getState();
    const next = moveSidebarProject(state.projects, state.settings, id, targetId, edge, state.sessions);
    if (next !== state.settings) void state.saveSettings(next);
  };
  const reorder = usePointerReorder({
    canDrop: (source, target) => settings.pinnedProjectIds.includes(source) === settings.pinnedProjectIds.includes(target),
    onDrop: persistMove,
  });
  const dragging = reorder.dragging;
  // Dragging a conversation toward the panes keeps a peeked panel open and hides hover cards.
  const splitDragging = useAppStore((state) => state.splitDrag !== null);
  useSidebarPanelHold(dragging !== null || splitDragging);

  const isExpanded = (id: string) => expanded[id] ?? (id === selectedProjectId || !!query.trim() || draftsOnly);

  return <SidebarHoverCards disabled={floating || dragging !== null || splitDragging}><div className="scroll-thin sidebar-project-list min-h-0 flex-1 overflow-y-auto" data-reorder-scope="">
            {groups.pinned.length > 0 && <section aria-label={t("Pinned")} className="sidebar-pinned-section">
              <p className="sidebar-section-label ui-caption">{t("Pinned")}</p>
              {groups.pinned.map((session) => <SidebarSessionRow key={session.id} session={session} project={projects.find((row) => row.id === session.projectId)} active={mainView === "session" && session.id === selectedSessionId} />)}
            </section>}
            <p id="sidebar-project-reorder-help" className="sr-only">{t("Drag folders to reorder, or use Option + Up/Down.")}</p>
            {groups.projects.map((item) => {
              const open = isExpanded(item.id);
              const nested = groups.nested.filter((session) => session.projectId === item.id);
              const count = sessions.filter((session) => session.projectId === item.id && !settings.archivedSessionIds.includes(session.id)).length;
              return <section key={item.id} className="sidebar-project-group" data-reorder-id={item.id} data-dragging={dragging === item.id || undefined} data-drop-edge={reorder.over?.id === item.id ? reorder.over.edge : undefined}>

                <SidebarProjectRow project={item} expanded={open} sessionCount={count} reorderProps={{
                  ...(groups.projects.length > 1 ? reorder.bind(item.id) : {}),
                  "aria-describedby": "sidebar-project-reorder-help",
                  onKeyDown: (event) => {
                    if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
                    event.preventDefault();
                    const index = groups.projects.findIndex(row => row.id === item.id);
                    const target = groups.projects[index + (event.key === "ArrowUp" ? -1 : 1)];
                    if (target) persistMove(item.id, target.id, event.key === "ArrowUp" ? "before" : "after");
                  },
                }} onSelect={() => {
                  setExpanded((state) => ({ ...state, [item.id]: !open }));
                  void selectProject(item.id).catch((error: unknown) => useAppStore.setState({ error: formatUnknownError(error) }));
                }} />
                <SidebarDisclosure open={open}><div className="sidebar-nested-sessions">
                  {count === 0 && <div className="flex flex-col items-center px-2 py-3 text-center">
                    <FolderHero /><p className="mt-2 max-w-[140px] ui-caption text-text-muted">{t("Sessions you start will show up here")}</p>
                    <div className="mt-3"><NewSessionButton compact onClick={() => { void selectProject(item.id).then(() => requestNewSession()).catch((error: unknown) => useAppStore.setState({ error: formatUnknownError(error) })); }} /></div>
                  </div>}
                  {/* Hundreds of sessions render as a viewport window (rows outside it are padding). */}
                  <SidebarWindowedRows items={nestTeamSessions(nested)} rowKey={({ session }) => session.id} renderRow={({ session, child }) => child
                    ? <div className="sidebar-team-child"><SidebarSessionRow session={session} project={item} active={mainView === "session" && session.id === selectedSessionId} /></div>
                    : <SidebarSessionRow session={session} project={item} active={mainView === "session" && session.id === selectedSessionId} />} />
                </div></SidebarDisclosure>
              </section>;
            })}

    {groups.projects.length === 0 && groups.pinned.length === 0 && <p className="px-2 py-3 ui-caption text-text-muted">{t(draftsOnly && !query.trim() ? "No conversations with unsent drafts" : "No sessions in this view")}</p>}
  </div></SidebarHoverCards>;
}
