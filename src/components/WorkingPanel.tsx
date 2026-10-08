import { useMemo, useState } from "react";
import type { Session } from "@/client/types";
import { ProjectGlyph } from "@/components/ProjectGlyph";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { activityElapsed, formatActivityDuration } from "@/lib/agent-activity";
import { stepSentence } from "@/lib/turn-timeline";
import { selectListedSessions, useAppStore } from "@/store/app-store";
import "@/styles/working-panel.css";

/** Sessions with an agent in flight or waiting for you: the panel opens at two or more (ADR-094). */
export const WORKING_MIN = 2;
/** Rows shown before "+N more" (MonoCode's live agents cap). */
export const WORKING_CAP = 4;

const inFlight = (session: Session) => ["starting", "running", "waiting"].includes(session.status);
const waiting = (session: Session) => session.status === "waiting" || Boolean(session.pendingRequests?.length);

/**
 * "Working" beside the composer, after MonoCode's live agents: each session in flight with
 * its provider, its project's icon, its title, what it is doing now and how long. Those
 * waiting for you come first. It shows only while the setting is on and two or more run.
 */
export function WorkingPanel({ now }: { now: number }) {
  const t = useTranslation();
  const enabled = useAppStore((state) => state.settings.showWorkingPanel);
  const sessions = useAppStore(selectListedSessions);
  const projects = useAppStore((state) => state.projects);
  const selectedSessionId = useAppStore((state) => state.selectedSessionId);
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => sessions.filter(inFlight).sort((a, b) =>
    Number(waiting(b)) - Number(waiting(a)) || (a.messages.at(-1)?.createdAt ?? "").localeCompare(b.messages.at(-1)?.createdAt ?? "")), [sessions]);
  if (!enabled || rows.length < WORKING_MIN) return null;
  const shown = expanded ? rows : rows.slice(0, WORKING_CAP);
  const extra = rows.length - WORKING_CAP;

  const doing = (session: Session) => {
    if (waiting(session)) return t("working.waiting");
    const last = session.messages.at(-1);
    const step = last?.activity?.items.filter((item) => item.kind !== "agent").at(-1);
    return step ? stepSentence(step, t, session.worktree.path) : t("working.running");
  };
  const elapsed = (session: Session) => {
    const activity = session.messages.at(-1)?.activity;
    return activity ? formatActivityDuration(activityElapsed(activity, now)) : "";
  };

  return <section aria-label={t("working.title")} className="working-panel" data-working-panel>
    <header className="working-panel-head">
      <span className="working-panel-dot" aria-hidden="true" />
      <span className="working-panel-title">{t("working.title")}</span>
      <span className="working-panel-count">{rows.length}</span>
    </header>
    <ol className="working-panel-list">
      {shown.map((session) => {
        const project = projects.find((row) => row.id === session.projectId);
        const needs = waiting(session);
        return <li key={session.id}>
          <button type="button" className="working-panel-row" aria-current={session.id === selectedSessionId ? "true" : undefined}
            data-needs={needs || undefined} onClick={() => { const store = useAppStore.getState(); store.setMainView("session"); void store.selectSession(session.id); }}>
            <span className="working-panel-icon" aria-hidden="true"><ProviderIcon id={session.agent} size={14} className="rounded-none bg-transparent" /></span>
            <span className="working-panel-body">
              <span className="working-panel-name">{session.title}</span>
              <span className="working-panel-meta">
                {project ? <ProjectGlyph project={project} size={12} /> : null}
                <span className="truncate">{project?.name}</span>
                <span aria-hidden="true">·</span>
                <span className="truncate">{doing(session)}</span>
              </span>
            </span>
            <span className="working-panel-time">{elapsed(session)}</span>
          </button>
        </li>;
      })}
    </ol>
    {extra > 0 ? <button type="button" className="working-panel-more" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      {expanded ? t("working.less") : t("working.more", { count: extra })}
    </button> : null}
  </section>;
}
