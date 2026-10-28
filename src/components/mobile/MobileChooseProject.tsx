import { useMemo, useState } from "react";
import { ChevronRight, Plus, Search, X } from "@/components/icons/phosphor";
import { ProjectGlyph } from "@/components/ProjectGlyph";
import { listedSessions, projectGroups } from "@/lib/mobile";
import { searchProjects, shortProjectPath } from "@/lib/phone-home";
import { usePhonePrefs } from "@/lib/phone-prefs";
import { useEnvironments } from "@/store/environments-store";
import type { MobileNavigation } from "./MobileApp";
import { useEnvironmentLabel, useMergedHome, useOpenOnEnvironment } from "./MobileEnvironments";
import { usePhoneTranslation as useTranslation } from "./use-phone-host";

/**
 * "Choose project" (ADR-129): the Home dock's new-conversation
 * button opens this sheet, in the phone's project order, with a floating glass search at the
 * bottom. Picking a project swaps the sheet for the new conversation with it preselected; the
 * first row adds a project (clone or folder path, ADR-131).
 */
export function MobileChooseProject({ navigation }: { navigation: MobileNavigation }) {
  const t = useTranslation();
  // Projects of every computer, the active one's first, under each computer's name (ADR-132).
  const merged = useMergedHome();
  const openOn = useOpenOnEnvironment(navigation);
  const environments = useEnvironments((state) => state.environments);
  const label = useEnvironmentLabel();
  const order = usePhonePrefs((state) => state.prefs.projectOrder);
  const [query, setQuery] = useState("");
  const ordered = useMemo(() => projectGroups(merged.projects, listedSessions(merged.sessions), order).map((group) => group.project), [merged, order]);
  const shown = useMemo(() => searchProjects(ordered, query), [ordered, query]);
  const sections = useMemo(() => {
    if (!merged.multiple) return [{ id: merged.storeId, projects: shown }];
    const ids = [merged.storeId, ...environments.map((item) => item.id).filter((id) => id !== merged.storeId)];
    return ids.map((id) => ({ id, projects: shown.filter((project) => (merged.environmentOf.get(project.id) ?? merged.storeId) === id) })).filter((section) => section.projects.length);
  }, [merged, environments, shown]);

  return <div className="mobile-page mobile-sheet mobile-choose-project">
    <span className="mobile-sheet-grip" aria-hidden="true" />
    <header className="mobile-sheet-head">
      <button type="button" className="mobile-sheet-close mobile-glass" aria-label={t("mobile.cancel")} onClick={navigation.back}><X size={17} aria-hidden="true" /></button>
      <h1>{t("phoneHome.chooseProject")}</h1>
      <span />
    </header>
    <div className="mobile-scroll mobile-choose-scroll">
      {query ? null : <div className="mobile-list mobile-choose-add">
        <button type="button" className="mobile-choose-row" onClick={() => navigation.open({ kind: "add-project", then: "new" })}>
          <span className="mobile-choose-glyph mobile-choose-plus"><Plus size={18} aria-hidden="true" /></span>
          <span className="mobile-choose-text"><span className="mobile-choose-name">{t("phoneProjects.add")}</span><span className="mobile-choose-path">{t("phoneProjects.addHelp")}</span></span>
          <ChevronRight size={15} className="mobile-choose-chevron" aria-hidden="true" />
        </button>
      </div>}
      {shown.length ? sections.map((section) => <div key={section.id}>
        {merged.multiple ? <h2 className="mobile-env-group">{label(environments.find((item) => item.id === section.id))}</h2> : null}
        <div className="mobile-list">
        {section.projects.map((project) => <button key={project.id} type="button" className="mobile-choose-row" onClick={() => openOn(section.id, { kind: "new", projectId: project.id }, "replace")}>
          <span className="mobile-choose-glyph"><ProjectGlyph project={project} size={20} /></span>
          <span className="mobile-choose-text">
            <span className="mobile-choose-name">{project.name}</span>
            <span className="mobile-choose-path" title={project.path}>{shortProjectPath(project.path)}</span>
          </span>
          <ChevronRight size={15} className="mobile-choose-chevron" aria-hidden="true" />
        </button>)}
        </div>
      </div>) : <p className="mobile-empty">{query ? t("phoneHome.noProjectMatch") : t("mobile.noProjects")}</p>}
    </div>
    <label className="mobile-dock-search mobile-glass mobile-choose-search">
      <Search size={17} aria-hidden="true" />
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("phoneHome.searchProjects")} aria-label={t("phoneHome.searchProjects")} enterKeyHint="search" />
    </label>
  </div>;
}
