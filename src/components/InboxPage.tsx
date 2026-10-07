import { useEffect, useMemo, type ReactNode } from "react";
import { Check, Clock3, GitPullRequest, Inbox } from "@/components/icons/phosphor";
import type { Session } from "@/client/types";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { StatusIndicator } from "@/primitives/StatusIndicator";
import { useTranslation } from "@/i18n/use-translation";
import { inboxGroups, needsYouCount } from "@/lib/inbox";
import { relativeTime } from "@/lib/session-board";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { selectListedSessions, useAppStore } from "@/store/app-store";
import "@/styles/inbox.css";

/**
 * Inbox (ADR-052): one page for what needs attention across projects. It is
 * derived from live session state, PR review requests and Astro habit errors;
 * nothing new is stored. Opening a session marks it seen.
 */
export function InboxPage() {
  const t = useTranslation();
  const sessions = useAppStore(selectListedSessions);
  const unseen = useAppStore((state) => state.unseenSessionIds);
  const archived = useAppStore((state) => state.settings.archivedSessionIds);
  const pulls = useAppStore((state) => state.githubInbox["pullRequest:open"]?.data);
  const automations = useAppStore((state) => state.automations?.automations);
  const projects = useAppStore((state) => state.projects);
  const astros = useAppStore((state) => state.astros);
  useEffect(() => {
    const store = useAppStore.getState();
    if (!store.automations) void store.automationAction({ type: "list" });
    if (!store.githubInbox["pullRequest:open"]) void store.loadGithubInbox("pullRequest", "open");
  }, []);
  const groups = useMemo(() => inboxGroups(sessions, unseen, archived, pulls, automations), [sessions, unseen, archived, pulls, automations]);
  const empty = needsYouCount(groups) + groups.running.length + groups.review.length + groups.failed.length === 0;
  // A failing habit opens its Astro's conversation with the Habits page of its drawer.
  const openHabits = (astroId: string) => { const store = useAppStore.getState(); void store.openAstro(astroId).then(() => store.setAstroDrawer({ astroId, page: "habits" })); };
  const open = (session: Session) => { const store = useAppStore.getState(); store.setMainView("session"); void store.selectSession(session.id); };
  const row = (session: Session) => {
    const time = relativeTime(session.lastActivityAt);
    return <button key={session.id} type="button" className="inbox-row" onClick={() => open(session)}>
      <ProviderIcon id={session.agent} size={16} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate ui-control text-text-primary">{session.title}</span>
        <span className="block truncate ui-caption text-text-muted">{projects.find((project) => project.id === session.projectId)?.name ?? ""}</span>
      </span>
      <StatusIndicator status={session.status} />
      <span className="w-10 shrink-0 text-right ui-caption text-text-muted">{time === "now" ? t("Now") : time}</span>
    </button>;
  };
  const section = (key: string, items: ReactNode[], count: number) => count ? <section className="inbox-section" aria-label={t(key)}>
    <p className="inbox-section-label ui-caption">{t(key)}<span className="tabular-nums">{count}</span></p>
    {items}
  </section> : null;

  return <section className="inbox-page" aria-label={t("inbox.title")}>
    <div className="scroll-thin inbox-scroll">
      <div className="inbox-column">
        <header className="flex items-center gap-2">
          <h1 className="ui-title flex-1 text-text-primary">{t("inbox.title")}</h1>
          <InteractiveButton variant="toolbar" disabled={unseen.length === 0} onClick={() => useAppStore.setState({ unseenSessionIds: [] })}><Check size={14} />{t("activity.markAllRead")}</InteractiveButton>
        </header>
        {empty ? <div className="inbox-empty">
          <Inbox size={30} className="text-text-muted" />
          <p className="ui-control text-text-primary">{t("inbox.emptyTitle")}</p>
          <p className="ui-description text-text-muted">{t("inbox.emptyHint")}</p>
        </div> : null}
        {section("inbox.needsYou", [
          ...groups.needsYou.map(row),
          groups.reviewRequests ? <button key="pulls" type="button" className="inbox-row" onClick={() => useAppStore.getState().setMainView("pulls")}>
            <GitPullRequest size={16} className="text-text-secondary" /><span className="min-w-0 flex-1 truncate text-left ui-control text-text-primary">{t("inbox.reviewRequests", { count: groups.reviewRequests })}</span>
          </button> : null,
          ...groups.habitIssues.map((habit) => <button key={`habit-${habit.id}`} type="button" className="inbox-row" onClick={() => openHabits(habit.astroId!)}>
            <Clock3 size={16} className="text-warning" /><span className="min-w-0 flex-1 truncate text-left ui-control text-text-primary">{t("inbox.habitIssue", { astro: astros?.find((astro) => astro.id === habit.astroId)?.name ?? "Astro", name: habit.name })}</span>
          </button>),
        ], needsYouCount(groups))}
        {section("inbox.running", groups.running.map(row), groups.running.length)}
        {section("inbox.review", groups.review.map(row), groups.review.length)}
        {section("inbox.failed", groups.failed.map(row), groups.failed.length)}
      </div>
    </div>
  </section>;
}
