import { nestTeamSessions } from "@/lib/team";
import "@/styles/team.css";
import { useSidebarPanelHold } from "@/components/SidebarPanelHold";
import { SidebarHoverCards } from "@/components/SidebarHoverCard";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { FolderHero } from "@/components/FolderHero";
import { NewSessionButton } from "@/components/NewSessionButton";
import { SidebarProjectRow, SidebarSessionRow } from "@/components/SidebarRows";
import { SidebarDisclosure, SidebarWindowedRows } from "@/components/SidebarWindow";
import { moveSidebarProject, sidebarGroups } from "@/lib/sidebar-layout";
import { formatUnknownError } from "@/lib/format-error";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore, selectSessionsMeta } from "@/store/app-store";

export function SidebarProjects({ floating = false, query = "", draftsOnly = false }: { floating?: boolean; query?: string; draftsOnly?: boolean }) {
  const t = useTranslation();
  const projects = useAppStore(state => state.projects);
  const selectedProjectId = useAppStore(state => state.selectedProjectId);
  const selectedSessionId = useAppStore(state => state.selectedSessionId);
  const sessions = useAppStore(selectSessionsMeta);
  const settings = useAppStore(state => state.settings);
  const drafts = useAppStore(state => state.composerDrafts);
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


  const [dragging, setDragging] = useState<string | null>(null);
  useSidebarPanelHold(dragging !== null);
  const [drop, setDrop] = useState<{ id: string; edge: "before" | "after" } | null>(null);
  const dragId = useRef<string | null>(null);
  const suppressClick = useRef(false);
  const persistMove = (id: string, targetId: string, edge: "before" | "after") => {
    const state = useAppStore.getState();
    const next = moveSidebarProject(state.projects, state.settings, id, targetId, edge, state.sessions);
    if (next !== state.settings) void state.saveSettings(next);
  };
  const endDrag = () => { dragId.current = null; setDragging(null); setDrop(null); };
  const dropEdge = (event: DragEvent<HTMLElement>, id: string) => {
    const source = dragId.current;
    if (!source || source === id || settings.pinnedProjectIds.includes(source) !== settings.pinnedProjectIds.includes(id)) return null;
    const rect = event.currentTarget.querySelector(".sidebar-project-open")?.getBoundingClientRect();
    if (!rect) return null;
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  };

  const isExpanded = (id: string) => expanded[id] ?? (id === selectedProjectId || !!query.trim() || draftsOnly);

  return <SidebarHoverCards disabled={floating || dragging !== null}><div className="scroll-thin sidebar-project-list min-h-0 flex-1 overflow-y-auto">
            {groups.pinned.length > 0 && <section aria-label={t("Pinned")} className="sidebar-pinned-section">
              <p className="sidebar-section-label ui-caption">{t("Pinned")}</p>
              {groups.pinned.map((session) => <SidebarSessionRow key={session.id} session={session} project={projects.find((row) => row.id === session.projectId)} active={mainView === "session" && session.id === selectedSessionId} />)}
            </section>}
            <p id="sidebar-project-reorder-help" className="sr-only">{t("Drag folders to reorder, or use Option + Up/Down.")}</p>
            {groups.projects.map((item) => {
              const open = isExpanded(item.id);
              const nested = groups.nested.filter((session) => session.projectId === item.id);
              const count = sessions.filter((session) => session.projectId === item.id && !settings.archivedSessionIds.includes(session.id)).length;
              return <section key={item.id} className="sidebar-project-group" data-dragging={dragging === item.id || undefined} data-drop-edge={drop?.id === item.id ? drop.edge : undefined}
                onDragOver={(event) => { const edge = dropEdge(event, item.id); if (edge) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (drop?.id !== item.id || drop.edge !== edge) setDrop({ id: item.id, edge }); } else setDrop(null); }}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null); }}
                onDrop={(event) => { const edge = dropEdge(event, item.id); if (edge && dragId.current) { event.preventDefault(); persistMove(dragId.current, item.id, edge); } endDrag(); }}>

                <SidebarProjectRow project={item} expanded={open} sessionCount={count} reorderProps={{
                  draggable: groups.projects.length > 1,
                  "aria-describedby": "sidebar-project-reorder-help",
                  onPointerDown: () => { suppressClick.current = false; },
                  onDragStart: (event) => { suppressClick.current = true; dragId.current = item.id; setDragging(item.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-switchyard-project", item.id); },
                  onDragEnd: endDrag,
                  onKeyDown: (event) => {
                    suppressClick.current = false;
                    if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
                    event.preventDefault();
                    const index = groups.projects.findIndex(row => row.id === item.id);
                    const target = groups.projects[index + (event.key === "ArrowUp" ? -1 : 1)];
                    if (target) persistMove(item.id, target.id, event.key === "ArrowUp" ? "before" : "after");
                  },
                }} onSelect={() => {
                  if (suppressClick.current) { suppressClick.current = false; return; }
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

    {groups.projects.length === 0 && <p className="px-2 py-3 ui-caption text-text-muted">{t("No sessions in this view")}</p>}
  </div></SidebarHoverCards>;
}
