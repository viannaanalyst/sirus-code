import { useMemo, useState } from "react";
import { ChevronLeft } from "@/components/icons/phosphor";
import { usePhoneTranslation as useTranslation } from "./use-phone-host";
import { filterByEnvironment, type EnvironmentFilter } from "@/lib/environments";
import { isSnoozed } from "@/lib/snooze";
import type { MobileNavigation } from "./MobileApp";
import { MobileSessionItem } from "./MobileSessionRow";
import { EnvironmentFilterBar, EnvironmentMarker, useMergedHome, useOpenOnEnvironment } from "./MobileEnvironments";
import { isAuxiliarySession } from "@/lib/pull-ask";

/**
 * Snoozed conversations (ADR-103, ADR-124), soonest back first: open one, or slide it to return now or change the time.
 * With several computers (ADR-132) every computer's snoozed conversations show, with a computer
 * filter at the top; returning one runs on its own computer (or waits for it).
 */
export function MobileSnoozed({ navigation }: { navigation: MobileNavigation }) {
  const t = useTranslation();
  const merged = useMergedHome();
  const openOn = useOpenOnEnvironment(navigation);
  const [filter, setFilter] = useState<EnvironmentFilter>("all");
  const all = useMemo(() => {
    return merged.sessions.filter((session) => isSnoozed(session) && !isAuxiliarySession(session))
      .sort((a, b) => Date.parse(a.snoozedUntil ?? "") - Date.parse(b.snoozedUntil ?? ""));
  }, [merged]);
  const list = useMemo(() => filterByEnvironment(all, merged.environmentOf, filter, merged.storeId), [all, merged, filter]);
  const byId = useMemo(() => new Map(merged.projects.map((project) => [project.id, project])), [merged]);
  return <div className="mobile-page">
    <header className="mobile-bar">
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.back")} onClick={navigation.back}><ChevronLeft size={18} aria-hidden="true" /></button>
      <div className="mobile-bar-title"><h1>{t("snooze.page")}</h1><p>{t("snooze.pageHelp")}</p></div>
    </header>
    <div className="mobile-scroll">
      <EnvironmentFilterBar value={filter} onChange={setFilter} />
      {list.length ? <div className="mobile-list mobile-section">
        {list.map((session) => {
          const environment = merged.environmentOf.get(session.id);
          const other = merged.multiple && environment && environment !== merged.storeId ? environment : undefined;
          return <MobileSessionItem key={session.id} session={session} project={byId.get(session.projectId)} snoozed environmentId={other}
            marker={merged.multiple ? <EnvironmentMarker environmentId={environment ?? merged.storeId} /> : undefined}
            onOpen={() => openOn(environment, { kind: "chat", sessionId: session.id })} />;
        })}
      </div> : <p className="mobile-empty">{t("snooze.none")}</p>}
    </div>
  </div>;
}
