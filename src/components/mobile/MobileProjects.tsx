import { useMemo, useState } from "react";
import { ChevronDown, Plus } from "@/components/icons/phosphor";
import { ProjectGlyph } from "@/components/ProjectGlyph";
import { useTranslation } from "@/i18n/use-translation";
import { listedSessions, projectGroups, shortAgo } from "@/lib/mobile";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";
import { MobileSessionItem } from "./MobileSessionRow";

/** Projects with the look chosen on the Mac; each opens in place to list its conversations. */
export function MobileProjects({ navigation }: { navigation: MobileNavigation }) {
  const t = useTranslation();
  const sessions = useAppStore(selectSessionsMeta);
  const projects = useAppStore((state) => state.projects);
  const archived = useAppStore((state) => state.settings.archivedSessionIds);
  const locale = useAppStore((state) => state.settings.locale);
  const [filter, setFilter] = useState<"all" | "active">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const groups = useMemo(() => projectGroups(projects, listedSessions(sessions, archived)), [projects, sessions, archived]);
  const active = groups.filter((group) => group.needsYou || group.working);
  const shown = filter === "active" ? active : groups;

  return <div className="mobile-page">
    <header className="mobile-header mobile-header-large">
      <div>
        <h1>{t("mobile.projects")}</h1>
        <p>{t("mobile.projectCount", { count: groups.length })} · {t("mobile.projectActive", { count: active.length })}</p>
      </div>
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.newConversation")} onClick={() => navigation.open({ kind: "new", projectId: null })}><Plus size={18} aria-hidden="true" /></button>
    </header>
    <div className="mobile-chips" role="tablist">
      {(["all", "active"] as const).map((id) => <button key={id} type="button" role="tab" aria-selected={filter === id} className="mobile-chip" onClick={() => setFilter(id)}>
        {t(id === "all" ? "mobile.all" : "mobile.active")} <span>{id === "all" ? groups.length : active.length}</span>
      </button>)}
    </div>
    <div className="mobile-scroll">
      {shown.length ? <div className="mobile-list">
        {shown.map(({ project, sessions: own, needsYou, working, lastActivityAt }) => {
          const expanded = openId === project.id;
          const status = needsYou ? t("mobile.needsYou") : working ? t("mobile.working") : t("mobile.lastActivity", { time: shortAgo(lastActivityAt, locale) });
          return <div key={project.id} className="mobile-project" data-expanded={expanded || undefined}>
            <button type="button" className="mobile-project-head" aria-expanded={expanded} onClick={() => setOpenId(expanded ? null : project.id)}>
              <span className="mobile-project-glyph"><ProjectGlyph project={project} size={20} /></span>
              <span className="mobile-project-text">
                <span className="mobile-project-name">{project.name}</span>
                <span className="mobile-project-status" data-attention={needsYou ? "" : undefined}>{status}</span>
              </span>
              <span className="mobile-project-count">{own.length}</span>
              <ChevronDown size={14} className="mobile-project-chevron" aria-hidden="true" />
            </button>
            {expanded ? <div className="mobile-project-sessions">
              {own.slice(0, 12).map((session) => <MobileSessionItem key={session.id} session={session} project={project} showProject={false} onOpen={() => navigation.open({ kind: "chat", sessionId: session.id })} />)}
              <button type="button" className="mobile-project-new" onClick={() => navigation.open({ kind: "new", projectId: project.id })}><Plus size={14} aria-hidden="true" />{t("mobile.newHere")}</button>
            </div> : null}
          </div>;
        })}
      </div> : <p className="mobile-empty">{t("mobile.noProjects")}</p>}
    </div>
  </div>;
}
