import { useMemo, useState } from "react";
import { ChevronLeft, Search } from "@/components/icons/phosphor";
import { usePhoneTranslation as useTranslation } from "./use-phone-host";
import { archivedMatches } from "@/lib/archived-search";
import { filterByEnvironment, type EnvironmentFilter } from "@/lib/environments";
import type { MobileNavigation } from "./MobileApp";
import { MobileSessionItem } from "./MobileSessionRow";
import { EnvironmentFilterBar, EnvironmentMarker, useMergedHome, useOpenOnEnvironment } from "./MobileEnvironments";
import "@/styles/mobile-settings.css";
import { isAuxiliarySession } from "@/lib/pull-ask";

/**
 * Archived conversations (ADR-086): open one, or slide it to restore or delete. A floating
 * glass search at the bottom filters them by title, project or branch (ADR-130).
 * With several computers (ADR-132) every computer's archive shows, with a computer filter at
 * the top; restoring runs on the conversation's own computer (or waits for it).
 */
export function MobileArchived({ navigation }: { navigation: MobileNavigation }) {
  const t = useTranslation();
  const merged = useMergedHome();
  const openOn = useOpenOnEnvironment(navigation);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<EnvironmentFilter>("all");
  const all = useMemo(() => {
    const archived = new Set(merged.archivedSessionIds);
    return merged.sessions.filter((session) => archived.has(session.id) && !isAuxiliarySession(session)).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }, [merged]);
  const list = useMemo(() => filterByEnvironment(all, merged.environmentOf, filter, merged.storeId), [all, merged, filter]);
  const byId = useMemo(() => new Map(merged.projects.map((project) => [project.id, project])), [merged]);
  const shown = useMemo(() => list.filter((session) => archivedMatches(query, session, byId.get(session.projectId)?.name)), [list, query, byId]);
  return <div className="mobile-page mobile-archived">
    <header className="mobile-bar">
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.back")} onClick={navigation.back}><ChevronLeft size={18} aria-hidden="true" /></button>
      <div className="mobile-bar-title"><h1>{t("mobile.archived")}</h1><p>{t("mobile.archivedHelp")}</p></div>
    </header>
    <div className="mobile-scroll">
      <EnvironmentFilterBar value={filter} onChange={setFilter} />
      {shown.length ? <div className="mobile-list mobile-section">
        {shown.map((session) => {
          const environment = merged.environmentOf.get(session.id);
          const other = merged.multiple && environment && environment !== merged.storeId ? environment : undefined;
          return <MobileSessionItem key={session.id} session={session} project={byId.get(session.projectId)} archived environmentId={other}
            marker={merged.multiple ? <EnvironmentMarker environmentId={environment ?? merged.storeId} /> : undefined}
            onOpen={() => openOn(environment, { kind: "chat", sessionId: session.id })} />;
        })}
      </div> : <p className="mobile-empty">{t(all.length ? "phoneSettings.noArchivedMatch" : "mobile.noArchived")}</p>}
    </div>
    {all.length ? <div className="mobile-dock">
      <label className="mobile-dock-search mobile-glass">
        <Search size={17} aria-hidden="true" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("phoneSettings.searchArchivedShort")} aria-label={t("phoneSettings.searchArchived")} enterKeyHint="search" />
      </label>
    </div> : null}
  </div>;
}
