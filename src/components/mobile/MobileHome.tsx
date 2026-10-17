import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Archive, Laptop, ListFilter, Moon, MoreHorizontal, Search, Server, SquarePen, X } from "@/components/icons/phosphor";
import { ProjectGlyph } from "@/components/ProjectGlyph";
import { useHostLabel, usePhoneTranslation as useTranslation } from "./use-phone-host";
import { homeSections, listedSessions, projectGroups } from "@/lib/mobile";
import { motionTokens } from "@/lib/motion";
import { activeHomeFilter, filterHomeSessions } from "@/lib/phone-home";
import { usePhonePrefs } from "@/lib/phone-prefs";
import { isSnoozed } from "@/lib/snooze";
import { selectSessionsMeta, selectSnoozedSessions, useAppStore } from "@/store/app-store";
import { useEnvironments } from "@/store/environments-store";
import type { MobileNavigation } from "./MobileApp";
import { MobileSessionItem } from "./MobileSessionRow";
import { EnvironmentMarker, EnvironmentSessionRow, EnvironmentStatus, useEnvironmentLabel, useMergedHome, useOpenOnEnvironment } from "./MobileEnvironments";
import { MobileListOptions } from "./MobileListOptions";
import { isAuxiliarySession } from "@/lib/pull-ask";

/**
 * Home: one inbox for every agent — what needs the person, what runs, then the rest. Settings open from the top corner and the bottom dock holds the list options (filter
 * by project or computer, kept per phone), search and a new conversation, which starts by
 * choosing its project unless a project filter is on. Rows sit on the page two lines each, under
 * small labels with a rule; a long press opens a row's menu and a swipe its two round actions
 * (ADR-129).
 */
export function MobileHome({ navigation, online }: { navigation: MobileNavigation; online: boolean }) {
  const t = useTranslation();
  const sessions = useAppStore(selectSessionsMeta);
  const archived = useAppStore((state) => state.settings.archivedSessionIds);
  const ready = useAppStore((state) => state.ready);
  const [query, setQuery] = useState("");
  const host = useHostLabel();
  const snoozed = useAppStore(selectSnoozedSessions);
  // Snoozed conversations wait on their own page until they come back (ADR-103).
  // Every computer's conversations together (ADR-132); with one computer this is the store's.
  const merged = useMergedHome();
  const openOn = useOpenOnEnvironment(navigation);
  // The dock's list options: one project and/or one computer, kept per phone (ADR-129 addendum).
  const environments = useEnvironments((state) => state.environments);
  const paired = useMemo(() => environments.filter((item) => item.token), [environments]);
  const label = useEnvironmentLabel();
  const storedProject = usePhonePrefs((state) => state.prefs.homeProject);
  const storedComputer = usePhonePrefs((state) => state.prefs.homeComputer);
  const filter = useMemo(() => activeHomeFilter({ projectId: storedProject, environmentId: storedComputer }, {
    projectIds: merged.projects.map((project) => project.id), environmentIds: paired.map((item) => item.id), multipleComputers: merged.multiple,
  }), [storedProject, storedComputer, merged, paired]);
  const projectOrder = usePhonePrefs((state) => state.prefs.projectOrder);
  const [optionsAnchor, setOptionsAnchor] = useState<HTMLElement | null>(null);
  const listed = useMemo(() => filterHomeSessions(listedSessions(merged.sessions, merged.archivedSessionIds).filter((session) => !isSnoozed(session)), filter, merged.environmentOf, merged.storeId), [merged, filter]);
  const orderedProjects = useMemo(() => optionsAnchor ? projectGroups(merged.projects, listedSessions(merged.sessions, merged.archivedSessionIds), projectOrder).map((group) => group.project) : [], [optionsAnchor, merged, projectOrder]);
  const filteredProject = filter.projectId ? merged.projects.find((project) => project.id === filter.projectId) : undefined;
  const filteredComputer = filter.environmentId ? paired.find((item) => item.id === filter.environmentId) : undefined;
  const filtering = !!(filteredProject || filteredComputer);
  const setPref = usePhonePrefs((state) => state.update);
  // With a project filter a new conversation starts in that project, on its computer.
  const newConversation = () => filteredProject
    ? openOn(merged.environmentOf.get(filteredProject.id) ?? merged.storeId, { kind: "new", projectId: filteredProject.id })
    : navigation.open({ kind: "choose-project" });
  // Snoozed and archived conversations of every computer (ADR-132 addendum).
  const snoozedCount = useMemo(() => merged.multiple ? merged.sessions.filter((session) => isSnoozed(session) && !isAuxiliarySession(session) && !merged.archivedSessionIds.includes(session.id)).length : snoozed.filter((session) => !archived.includes(session.id)).length, [merged, snoozed, archived]);
  const macOrder = useAppStore((state) => state.settings.sidebarThreadSortOrder);
  const order = usePhonePrefs((state) => state.prefs.threadOrder) ?? macOrder;
  const sections = useMemo(() => homeSections(listed, merged.projects, query, merged.pinnedSessionIds, order), [listed, merged, query, order]);
  const archivedCount = useMemo(() => merged.multiple ? merged.sessions.filter((session) => merged.archivedSessionIds.includes(session.id) && !isAuxiliarySession(session)).length : sessions.filter((session) => archived.includes(session.id) && !isAuxiliarySession(session)).length, [merged, sessions, archived]);
  const byId = useMemo(() => new Map(merged.projects.map((project) => [project.id, project])), [merged]);
  const groups = [
    { key: "needsYou", title: t("mobile.needsYou"), items: sections.needsYou },
    { key: "working", title: t("mobile.working"), items: sections.working },
    { key: "pinned", title: t("mobile.pinnedSection"), items: sections.pinned },
    { key: "recent", title: t("mobile.recent"), items: sections.recent.slice(0, 40) },
  ].filter((group) => group.items.length);

  return <div className="mobile-page">
    <header className="mobile-header">
      <div className="mobile-brand"><img src="/sirus-glyph-small.png" alt="" width={22} height={22} /><h1>Sirus</h1></div>
      <div className="mobile-header-actions">
        {online ? null : <span className="mobile-host">{host} <span>{t("mobile.offline")}</span></span>}
        <button type="button" className="mobile-round-button mobile-glass" aria-label={t("mobile.settings")} title={t("mobile.settings")} onClick={() => navigation.open({ kind: "settings" })}><MoreHorizontal size={20} aria-hidden="true" /></button>
      </div>
    </header>
    <div className="mobile-scroll">
      <EnvironmentStatus />
      <AnimatePresence initial={false}>
        {filtering ? <motion.div key="filters" className="mobile-home-filters" role="group" aria-label={t("phoneHome.activeFilters")}
          initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: motionTokens.normal, ease: motionTokens.ease }}>
          {filteredProject ? <button type="button" className="mobile-home-chip" aria-label={t("phoneHome.clearFilter", { name: filteredProject.name })} onClick={() => setPref({ homeProject: undefined })}>
            <ProjectGlyph project={filteredProject} size={13} /><span>{filteredProject.name}</span><span className="mobile-home-chip-x" aria-hidden="true"><X size={10} /></span>
          </button> : null}
          {filteredComputer ? <button type="button" className="mobile-home-chip" aria-label={t("phoneHome.clearFilter", { name: label(filteredComputer) })} onClick={() => setPref({ homeComputer: undefined })}>
            {filteredComputer.kind === "server" ? <Server size={13} aria-hidden="true" /> : <Laptop size={13} aria-hidden="true" />}<span>{label(filteredComputer)}</span><span className="mobile-home-chip-x" aria-hidden="true"><X size={10} /></span>
          </button> : null}
        </motion.div> : null}
      </AnimatePresence>
      {groups.map((group) => <section key={group.key} className="mobile-section mobile-home-section">
        <h2>{group.title} <span>{group.items.length}</span></h2>
        <div className="mobile-home-list">
          {group.items.map((session) => {
            const environment = merged.environmentOf.get(session.id);
            const open = () => openOn(environment, { kind: "chat", sessionId: session.id });
            return merged.multiple && environment && environment !== merged.storeId
              ? <EnvironmentSessionRow key={session.id} session={session} project={byId.get(session.projectId)} environmentId={environment} onOpen={open} />
              : <MobileSessionItem key={session.id} session={session} project={byId.get(session.projectId)} arrange marker={merged.multiple ? <EnvironmentMarker environmentId={environment} /> : undefined} onOpen={open} />;
          })}
        </div>
      </section>)}
      {ready && !groups.length ? <p className="mobile-empty">{query ? t("mobile.noResults") : filtering ? t("phoneHome.filterEmpty") : t("mobile.empty")}</p> : null}
      {snoozedCount && !query ? <button type="button" className="mobile-archived-link" onClick={() => navigation.open({ kind: "snoozed" })}><Moon size={15} aria-hidden="true" />{t("snooze.group", { count: snoozedCount })}</button> : null}
      {archivedCount && !query ? <button type="button" className="mobile-archived-link" onClick={() => navigation.open({ kind: "archived" })}><Archive size={15} aria-hidden="true" />{t("mobile.archivedCount", { count: archivedCount })}</button> : null}
      {ready && groups.length ? <p className="mobile-help mobile-center mobile-swipe-hint">{t("phoneHome.swipeHint")}</p> : null}
    </div>
    <div className="mobile-dock">
      <button type="button" className="mobile-round-button mobile-glass" data-active={filtering || undefined} aria-label={t("phoneHome.listOptions")} title={t("phoneHome.listOptions")} aria-haspopup="menu" aria-expanded={!!optionsAnchor}
        onClick={(event) => setOptionsAnchor(event.currentTarget)}><ListFilter size={20} aria-hidden="true" /></button>
      <label className="mobile-dock-search mobile-glass">
        <Search size={17} aria-hidden="true" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("mobile.searchShort")} aria-label={t("mobile.search")} enterKeyHint="search" />
      </label>
      <button type="button" className="mobile-round-button mobile-glass" aria-label={t("mobile.newConversation")} title={t("mobile.newConversation")} onClick={newConversation}><SquarePen size={20} aria-hidden="true" /></button>
    </div>
    <MobileListOptions open={!!optionsAnchor} anchor={optionsAnchor} projects={orderedProjects} environments={paired} environmentOf={merged.environmentOf} storeId={merged.storeId}
      filter={filter} onProject={(projectId) => setPref({ homeProject: projectId ?? undefined })} onComputer={(environmentId) => setPref({ homeComputer: environmentId ?? undefined })}
      onSeeProjects={() => navigation.open({ kind: "projects" })} onClose={() => setOptionsAnchor(null)} />
  </div>;
}
