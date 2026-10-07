import { useMemo, useState } from "react";
import { Archive, Plus, Search } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { homeSections, listedSessions } from "@/lib/mobile";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";
import { MobileSessionItem } from "./MobileSessionRow";

/** Home: one inbox for every agent — what needs the person, what runs, then the rest. */
export function MobileHome({ navigation, online }: { navigation: MobileNavigation; online: boolean }) {
  const t = useTranslation();
  const sessions = useAppStore(selectSessionsMeta);
  const projects = useAppStore((state) => state.projects);
  const archived = useAppStore((state) => state.settings.archivedSessionIds);
  const pinned = useAppStore((state) => state.settings.pinnedSessionIds);
  const ready = useAppStore((state) => state.ready);
  const [query, setQuery] = useState("");
  const listed = useMemo(() => listedSessions(sessions, archived), [sessions, archived]);
  const sections = useMemo(() => homeSections(listed, projects, query, pinned), [listed, projects, query, pinned]);
  const archivedCount = useMemo(() => sessions.filter((session) => archived.includes(session.id) && !session.sideChat && !session.astro).length, [sessions, archived]);
  const byId = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const groups = [
    { key: "needsYou", title: t("mobile.needsYou"), items: sections.needsYou },
    { key: "working", title: t("mobile.working"), items: sections.working },
    { key: "pinned", title: t("mobile.pinnedSection"), items: sections.pinned },
    { key: "recent", title: t("mobile.recent"), items: sections.recent.slice(0, 40) },
  ].filter((group) => group.items.length);

  return <div className="mobile-page">
    <header className="mobile-header">
      <div className="mobile-brand"><img src="/sirus-glyph-small.png" alt="" width={22} height={22} /><h1>Sirus</h1></div>
      <span className="mobile-host" data-online={online || undefined}>Mac <span>{online ? t("mobile.online") : t("mobile.offline")}</span></span>
    </header>
    <label className="mobile-search">
      <Search size={15} aria-hidden="true" />
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("mobile.search")} aria-label={t("mobile.search")} enterKeyHint="search" />
    </label>
    <div className="mobile-scroll">
      {groups.map((group) => <section key={group.key} className="mobile-section">
        <h2>{group.title} <span>{group.items.length}</span></h2>
        <div className="mobile-list">
          {group.items.map((session) => <MobileSessionItem key={session.id} session={session} project={byId.get(session.projectId)} onOpen={() => navigation.open({ kind: "chat", sessionId: session.id })} />)}
        </div>
      </section>)}
      {ready && !groups.length ? <p className="mobile-empty">{query ? t("mobile.noResults") : t("mobile.empty")}</p> : null}
      {archivedCount && !query ? <button type="button" className="mobile-archived-link" onClick={() => navigation.open({ kind: "archived" })}><Archive size={15} aria-hidden="true" />{t("mobile.archivedCount", { count: archivedCount })}</button> : null}
      {ready && groups.length ? <p className="mobile-help mobile-center mobile-swipe-hint">{t("mobile.swipeHint")}</p> : null}
    </div>
    <button type="button" className="mobile-fab mobile-glass" aria-label={t("mobile.newConversation")} title={t("mobile.newConversation")} onClick={() => navigation.open({ kind: "new", projectId: null })}><Plus size={24} aria-hidden="true" /></button>
  </div>;
}
