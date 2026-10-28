import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, FolderPlus, Plus } from "@/components/icons/phosphor";
import { ProjectIcon } from "@/components/ProjectAvatar";
import { usePhoneTranslation as useTranslation } from "./use-phone-host";
import { listedSessions, projectGroups, shortAgo } from "@/lib/mobile";
import { usePhonePrefs } from "@/lib/phone-prefs";
import { isSnoozed } from "@/lib/snooze";
import { useAppStore } from "@/store/app-store";
import { useEnvironments } from "@/store/environments-store";
import type { MobileNavigation } from "./MobileApp";
import { EnvironmentSessionRow, useEnvironmentLabel, useMergedHome, useOpenOnEnvironment } from "./MobileEnvironments";
import { MobileSessionItem } from "./MobileSessionRow";

/** Projects with the look chosen on the Mac (from the home dock); each opens in place to list its conversations. */
export function MobileProjects({ navigation }: { navigation: MobileNavigation }) {
  const t = useTranslation();
  // Projects of every computer, grouped under each computer's name (ADR-132).
  const merged = useMergedHome();
  const openOn = useOpenOnEnvironment(navigation);
  const environments = useEnvironments((state) => state.environments);
  const label = useEnvironmentLabel();
  const locale = useAppStore((state) => state.settings.locale);
  const [filter, setFilter] = useState<"all" | "active">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const order = usePhonePrefs((state) => state.prefs.projectOrder);
  // Snoozed conversations wait on the Snoozed page until they wake, as on Home.
  const groups = useMemo(() => projectGroups(merged.projects, listedSessions(merged.sessions).filter((session) => !isSnoozed(session)), order), [merged, order]);
  const active = groups.filter((group) => group.needsYou || group.working);
  const shown = filter === "active" ? active : groups;
  const environmentOf = (id: string) => merged.environmentOf.get(id) ?? merged.storeId;
  const sections = merged.multiple
    ? [merged.storeId, ...environments.map((item) => item.id).filter((id) => id !== merged.storeId)].map((id) => ({ id, groups: shown.filter((group) => environmentOf(group.project.id) === id) })).filter((section) => section.groups.length)
    : [{ id: merged.storeId, groups: shown }];

  return <div className="mobile-page">
    <header className="mobile-bar">
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.back")} onClick={navigation.back}><ChevronLeft size={18} aria-hidden="true" /></button>
      <div className="mobile-bar-title">
        <h1>{t("mobile.projects")}</h1>
        <p>{t("mobile.projectCount", { count: groups.length })} · {t("mobile.projectActive", { count: active.length })}</p>
      </div>
      <div className="mobile-bar-actions">
        <button type="button" className="mobile-icon-button" aria-label={t("phoneProjects.add")} title={t("phoneProjects.add")} onClick={() => navigation.open({ kind: "add-project", then: "back" })}><FolderPlus size={18} aria-hidden="true" /></button>
        <button type="button" className="mobile-icon-button" aria-label={t("mobile.newConversation")} onClick={() => navigation.open({ kind: "new", projectId: null })}><Plus size={18} aria-hidden="true" /></button>
      </div>
    </header>
    <div className="mobile-chips" role="tablist">
      {(["all", "active"] as const).map((id) => <button key={id} type="button" role="tab" aria-selected={filter === id} className="mobile-chip" onClick={() => setFilter(id)}>
        {t(id === "all" ? "mobile.all" : "mobile.active")} <span>{id === "all" ? groups.length : active.length}</span>
      </button>)}
    </div>
    <div className="mobile-scroll">
      {shown.length ? sections.map((section) => <div key={section.id}>
        {merged.multiple ? <h2 className="mobile-env-group">{label(environments.find((item) => item.id === section.id))}</h2> : null}
        <div className="mobile-list">
        {section.groups.map(({ project, sessions: own, needsYou, working, lastActivityAt }) => {
          const expanded = openId === project.id;
          const status = needsYou ? t("mobile.needsYou") : working ? t("mobile.working") : t("mobile.lastActivity", { time: shortAgo(lastActivityAt, locale) });
          return <div key={project.id} className="mobile-project" data-expanded={expanded || undefined}>
            <button type="button" className="mobile-project-head" aria-expanded={expanded} onClick={() => setOpenId(expanded ? null : project.id)}>
              <span className="mobile-project-glyph"><ProjectIcon project={project} size={20} /></span>
              <span className="mobile-project-text">
                <span className="mobile-project-name">{project.name}</span>
                <span className="mobile-project-status" data-attention={needsYou ? "" : undefined}>{status}</span>
              </span>
              <span className="mobile-project-count">{own.length}</span>
              <ChevronDown size={14} className="mobile-project-chevron" aria-hidden="true" />
            </button>
            {expanded ? <div className="mobile-project-sessions">
              {own.slice(0, 12).map((session) => section.id === merged.storeId
                ? <MobileSessionItem key={session.id} session={session} project={project} showProject={false} onOpen={() => navigation.open({ kind: "chat", sessionId: session.id })} />
                : <EnvironmentSessionRow key={session.id} session={session} project={project} environmentId={section.id} onOpen={() => openOn(section.id, { kind: "chat", sessionId: session.id })} />)}
              <button type="button" className="mobile-project-new" onClick={() => openOn(section.id, { kind: "new", projectId: project.id })}><Plus size={14} aria-hidden="true" />{t("mobile.newHere")}</button>
            </div> : null}
          </div>;
        })}
        </div>
      </div>) : <div className="mobile-empty-add">
        <p className="mobile-empty">{t("mobile.noProjects")}</p>
        <button type="button" className="mobile-primary" onClick={() => navigation.open({ kind: "add-project", then: "back" })}><FolderPlus size={15} aria-hidden="true" />{t("phoneProjects.add")}</button>
      </div>}
    </div>
  </div>;
}
