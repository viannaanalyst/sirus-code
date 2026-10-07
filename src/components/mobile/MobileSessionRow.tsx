import type { Project, Session } from "@/client/types";
import { AgentIcon } from "@/components/AgentIcon";
import { ProjectGlyph } from "@/components/ProjectGlyph";
import { LoaderCircle } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { sessionBadge, shortAgo } from "@/lib/mobile";
import { useAppStore } from "@/store/app-store";

const BADGE_KEYS = { approve: "mobile.approve", question: "mobile.question", working: "mobile.workingBadge", failed: "mobile.failed", stopped: "mobile.stopped" } as const;

/** One conversation in a phone list: project, state, title, branch and age. */
export function MobileSessionRow({ session, project, showProject = true, onOpen }: { session: Session; project: Project | undefined; showProject?: boolean; onOpen: () => void }) {
  const t = useTranslation();
  const locale = useAppStore((state) => state.settings.locale);
  const badge = sessionBadge(session);
  return <button type="button" className="mobile-row" onClick={onOpen}>
    <span className="mobile-row-top">
      {showProject && project ? <span className="mobile-row-project"><ProjectGlyph project={project} size={13} />{project.name}</span> : null}
      {badge ? <span className="mobile-badge" data-badge={badge}>{badge === "working" ? <LoaderCircle size={11} className="animate-spin" aria-hidden="true" /> : null}{t(BADGE_KEYS[badge])}</span> : null}
    </span>
    <span className="mobile-row-title">{session.title}</span>
    <span className="mobile-row-meta">
      <span className="mobile-row-branch">{session.worktree.branch}</span>
      <span aria-hidden="true">·</span>
      <span>{shortAgo(session.lastActivityAt, locale)}</span>
      <AgentIcon id={session.agent} className="mobile-row-agent" />
    </span>
  </button>;
}
