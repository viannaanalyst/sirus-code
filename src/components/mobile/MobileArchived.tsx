import { useMemo } from "react";
import { ChevronLeft } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";
import { MobileSessionItem } from "./MobileSessionRow";

/** Archived conversations (ADR-086): open one, or slide it to restore or delete. */
export function MobileArchived({ navigation }: { navigation: MobileNavigation }) {
  const t = useTranslation();
  const sessions = useAppStore(selectSessionsMeta);
  const projects = useAppStore((state) => state.projects);
  const archived = useAppStore((state) => state.settings.archivedSessionIds);
  const list = useMemo(() => sessions.filter((session) => archived.includes(session.id) && !session.sideChat && !session.astro).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)), [sessions, archived]);
  const byId = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  return <div className="mobile-page">
    <header className="mobile-bar">
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.back")} onClick={navigation.back}><ChevronLeft size={18} aria-hidden="true" /></button>
      <div className="mobile-bar-title"><h1>{t("mobile.archived")}</h1><p>{t("mobile.archivedHelp")}</p></div>
    </header>
    <div className="mobile-scroll">
      {list.length ? <div className="mobile-list mobile-section">
        {list.map((session) => <MobileSessionItem key={session.id} session={session} project={byId.get(session.projectId)} archived onOpen={() => navigation.open({ kind: "chat", sessionId: session.id })} />)}
      </div> : <p className="mobile-empty">{t("mobile.noArchived")}</p>}
    </div>
  </div>;
}
