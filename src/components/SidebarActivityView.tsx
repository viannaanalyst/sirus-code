import { useMemo, useState } from "react";
import { ArrowUpDown, Check, ChevronDown, ChevronRight, Plus, SquarePen } from "@/components/icons/phosphor";
import { SidebarActivityRow } from "@/components/SidebarRows";
import { SidebarHoverCards } from "@/components/SidebarHoverCard";
import { useSidebarPanelHold } from "@/components/SidebarPanelHold";
import { SidebarWindowedRows } from "@/components/SidebarWindow";
import { useTranslation } from "@/i18n/use-translation";
import { sidebarTimeline } from "@/lib/sidebar-panels";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/primitives/Dropdown";
import { Tooltip } from "@/primitives/Tooltip";
import { selectListedSessions, useAppStore } from "@/store/app-store";

/**
 * The sidebar's Activity view: every listed session across projects, grouped by
 * what needs attention, then by day, then Done. Scope and open sections are view
 * state; the view itself is the persisted `sidebarActivityView` setting.
 */
export function SidebarActivityView({ floating, draftsOnly }: { floating: boolean; draftsOnly: boolean }) {
  const t = useTranslation();
  const projects = useAppStore((state) => state.projects);
  const sessions = useAppStore(selectListedSessions);
  const settings = useAppStore((state) => state.settings);
  const drafts = useAppStore((state) => state.composerDrafts);
  const unseen = useAppStore((state) => state.unseenSessionIds);
  const splitDragging = useAppStore((state) => state.splitDrag !== null);
  useSidebarPanelHold(splitDragging);
  const selectedSessionId = useAppStore((state) => state.selectedSessionId);
  const mainView = useAppStore((state) => state.mainView);
  const [scope, setScope] = useState<string | null>(null);
  // Earlier starts open, Done starts closed; view state only.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ done: true });
  const liveScope = scope && projects.some((project) => project.id === scope) ? scope : null;
  // Day boundaries move at most once per render; no timer is needed for a list.
  const sections = useMemo(() => sidebarTimeline(projects, sessions, settings, drafts, new Date(), { scope: liveScope, draftsOnly }), [projects, sessions, settings, drafts, liveScope, draftsOnly]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of sessions) if (!settings.archivedSessionIds.includes(session.id)) map.set(session.projectId, (map.get(session.projectId) ?? 0) + 1);
    return map;
  }, [sessions, settings.archivedSessionIds]);
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const scopeLabel = liveScope ? projects.find((project) => project.id === liveScope)?.name ?? t("activity.all") : t("activity.all");
  const active = (id: string) => mainView === "session" && selectedSessionId === id;

  return <>
    <div className="sidebar-activity-toolbar">
      <Dropdown>
        <DropdownTrigger asChild>
          <button type="button" className="sidebar-activity-scope ui-body" aria-label={t("activity.scope")}><span className="truncate">{scopeLabel}</span><ChevronRight size={13} aria-hidden="true" /></button>
        </DropdownTrigger>
        <DropdownContent align="start" side="bottom">
          <p className="px-2 py-1 ui-caption text-text-muted">{t("activity.scope")}</p>
          <DropdownItem onSelect={() => setScope(null)}><span className="flex min-w-[180px] items-center gap-2"><span className="flex-1">{t("activity.all")}</span><span className="text-text-muted tabular-nums">{total}</span>{!liveScope ? <Check size={13} /> : <span className="w-[13px]" />}</span></DropdownItem>
          <DropdownSeparator />
          {projects.map((project) => <DropdownItem key={project.id} onSelect={() => setScope(project.id)}><span className="flex min-w-[180px] items-center gap-2"><span className="min-w-0 flex-1 truncate">{project.name}</span><span className="text-text-muted tabular-nums">{counts.get(project.id) ?? 0}</span>{liveScope === project.id ? <Check size={13} /> : <span className="w-[13px]" />}</span></DropdownItem>)}
        </DropdownContent>
      </Dropdown>
      <span className="sidebar-activity-quick">
        <Tooltip label={t("activity.newChat")}><button type="button" className="sidebar-header-action" aria-label={t("activity.newChatHint")} onClick={() => useAppStore.getState().requestNewSession()}><SquarePen size={14} /></button></Tooltip>
        <Tooltip label={t("activity.addProject")}><button type="button" className="sidebar-header-action" aria-label={t("activity.addProject")} onClick={() => void useAppStore.getState().addProjectFromPicker()}><Plus size={15} /></button></Tooltip>
      </span>
      <Dropdown>
        <Tooltip label={t("activity.options")}><DropdownTrigger asChild>
          <button type="button" className="sidebar-header-action" aria-label={t("activity.options")}><ArrowUpDown size={14} /></button>
        </DropdownTrigger></Tooltip>
        <DropdownContent align="end" side="bottom">
          <DropdownItem disabled={unseen.length === 0} onSelect={() => useAppStore.setState({ unseenSessionIds: [] })}>{t("activity.markAllRead")}</DropdownItem>
        </DropdownContent>
      </Dropdown>
    </div>
    <SidebarHoverCards disabled={floating || splitDragging}><div className="scroll-thin sidebar-project-list sidebar-activity-list min-h-0 flex-1 overflow-y-auto">
      {sections.map((section) => {
        const collapsible = section.key === "earlier" || section.key === "done";
        const closed = collapsible && collapsed[section.key] === true;
        // A closed section still shows the open conversation, like Synara.
        const rows = closed ? section.sessions.filter((session) => active(session.id)) : section.sessions;
        return <section key={section.key} aria-label={t(section.label)}>
          {collapsible ? <button type="button" className="sidebar-section-label sidebar-activity-section-toggle ui-caption" aria-expanded={!closed} onClick={() => setCollapsed((state) => ({ ...state, [section.key]: !closed }))}>
            <span>{t(section.label)}</span>{closed ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}{section.key === "done" ? <span className="tabular-nums">{section.sessions.length}</span> : null}
          </button> : <p className="sidebar-section-label ui-caption">{t(section.label)}</p>}
          <SidebarWindowedRows items={rows} rowKey={(session) => session.id} renderRow={(session) => <SidebarActivityRow session={session} project={projects.find((project) => project.id === session.projectId)} active={active(session.id)} done={section.key === "done"} unseen={unseen.includes(session.id)} />} />
        </section>;
      })}
      {sections.length === 0 && <p className="px-2 py-3 ui-caption text-text-muted">{t(draftsOnly ? "No conversations with unsent drafts" : "No sessions in this view")}</p>}
    </div></SidebarHoverCards>
  </>;
}
