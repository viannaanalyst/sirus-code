import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, GitMerge, Lock, Square, SquareArrowOutUpRight, Users, X } from "@/components/icons/phosphor";
import type { AgentProviderId, Session, TeamTask } from "@/client/types";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { providerById } from "@/lib/providers";
import { modelDisplayName } from "@/lib/model-registry";
import { taskView, workerChanges, type TaskView } from "@/lib/team";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import "@/styles/team.css";
import { useRetainedTranscripts } from "@/lib/use-retained-transcripts";

const TEAM_PROVIDERS: AgentProviderId[] = ["codex", "claude", "opencode"];
const assignmentKey = (provider: AgentProviderId, model: string | null) => `${provider}::${model ?? ""}`;

function useAssignees() {
  const models = useAppStore(state => state.modelsByProvider);
  const disabled = useAppStore(state => state.settings.disabledProviders);
  return TEAM_PROVIDERS.filter(provider => !disabled.includes(provider)).flatMap(provider => {
    const catalog = models[provider]?.models ?? [];
    const name = providerById(provider).name;
    const rows = catalog.slice(0, 8).map(model => ({ key: assignmentKey(provider, model.id), provider, model: model.id as string | null, label: `${name} · ${modelDisplayName(provider, model.displayName, catalog.map(row => row.displayName))}` }));
    return rows.length ? rows : [{ key: assignmentKey(provider, null), provider, model: null, label: name }];
  });
}

function useAssigneeLabel() {
  const models = useAppStore(state => state.modelsByProvider);
  return (provider: AgentProviderId, model: string | null) => {
    const name = providerById(provider).name;
    if (!model) return name;
    const catalog = models[provider]?.models ?? [];
    return `${name} · ${modelDisplayName(provider, catalog.find(row => row.id === model)?.displayName ?? model, catalog.map(row => row.displayName))}`;
  };
}

/** Plan, team progress and merge for one coordinator session. Every action is explicit. */
export function TeamPanel({ session }: { session: Session }) {
  const team = session.team;
  if (!team || team.status === "planning") return null;
  if (team.status === "failed") return <TeamFailed session={session} />;
  if (team.status === "proposed") return <PlanCard session={session} />;
  return <>
    <PlanCard session={session} locked />
    {team.status === "running" || (team.status === "stopped" && !team.tasks.some(task => task.state === "done")) ? <ProgressCard session={session} /> : <FinishCard session={session} />}
  </>;
}

function TeamFailed({ session }: { session: Session }) {
  const t = useTranslation();
  const teamAction = useAppStore(state => state.teamAction);
  return <section className="team-card" aria-label={t("team.plan")}>
    <header className="team-card-head"><AlertTriangle size={14} aria-hidden="true" className="text-warning" /><h3 className="ui-control">{t("team.failed")}</h3><span className="team-spacer" /><button type="button" className="team-button" onClick={() => void teamAction({ type: "discard", sessionId: session.id })}>{t("team.discard")}</button></header>
    <p className="team-note ui-caption">{session.team?.error ? `${session.team.error} ` : ""}{t("team.failedHint")}</p>
  </section>;
}

function PlanCard({ session, locked = false }: { session: Session; locked?: boolean }) {
  const t = useTranslation();
  const team = session.team!;
  const assignees = useAssignees();
  const label = useAssigneeLabel();
  const teamAction = useAppStore(state => state.teamAction);
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, { title: string; provider: AgentProviderId; model: string | null }>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const tasks = team.tasks.filter(task => !removed.includes(task.id));
  const current = (task: TeamTask) => edits[task.id] ?? { title: task.title, provider: task.provider, model: task.model };
  const approval = session.execution?.approval === "auto" ? "auto" : "ask";
  const number = (id: string | null) => team.tasks.findIndex(task => task.id === id) + 1;
  const start = async () => {
    setBusy(true);
    try { await teamAction({ type: "start", sessionId: session.id, approval, tasks: tasks.map(task => ({ id: task.id, ...current(task) })) }); } finally { setBusy(false); }
  };
  return <section className="team-card" aria-label={t("team.plan")}>
    <header className="team-card-head">
      <Users size={14} aria-hidden="true" /><h3 className="ui-control">{t("team.plan")}</h3><span className="team-spacer" />
      {locked ? <span className="team-tag ui-micro"><Check size={11} aria-hidden="true" />{t("team.confirmed")}</span> : null}
      <button type="button" className="team-button team-button-ghost" aria-expanded={details} onClick={() => setDetails(!details)}>{t("team.details")}<ChevronDown size={12} aria-hidden="true" className={details ? "team-chevron open" : "team-chevron"} /></button>
    </header>
    {(locked ? team.tasks : tasks).map((task, index) => {
      const value = current(task);
      return <div key={task.id} className="team-row-wrap">
        <div className="team-row">
          <span className="team-number ui-micro">{index + 1}</span>
          <div className="team-what">
            {locked ? <><p className="team-title ui-control">{task.title}</p><p className="team-sub ui-caption">{label(task.provider, task.model)}</p></>
              : <input aria-label={t("team.plan")} className="team-title-input ui-control" value={value.title} maxLength={120} onChange={event => setEdits({ ...edits, [task.id]: { ...value, title: event.target.value } })} />}
          </div>
          {locked ? null : <>
            <ProviderIcon id={value.provider} size={16} />
            <select aria-label={t("team.assignee")} className="team-select ui-caption" value={assignmentKey(value.provider, value.model)} onChange={event => { const next = assignees.find(row => row.key === event.target.value); if (next) setEdits({ ...edits, [task.id]: { ...value, provider: next.provider, model: next.model } }); }}>
              {assignees.some(row => row.key === assignmentKey(value.provider, value.model)) ? null : <option value={assignmentKey(value.provider, value.model)}>{label(value.provider, value.model)}</option>}
              {assignees.map(row => <option key={row.key} value={row.key}>{row.label}</option>)}
            </select>
            <button type="button" className="team-icon-button" aria-label={`${t("team.removeTask")} · ${value.title}`} disabled={tasks.length <= 1} onClick={() => setRemoved([...removed, task.id])}><X size={13} aria-hidden="true" /></button>
          </>}
        </div>
        {details ? <div className="team-details">
          {task.paths.map(path => <span key={path} className="team-scope ui-micro"><Lock size={10} aria-hidden="true" />{path}</span>)}
          {task.after ? <span className="team-tag ui-micro">{t("team.after", { number: number(task.after) })}</span> : null}
          <span className="team-tag ui-micro">{t("team.ownWorktree")}</span>
        </div> : null}
      </div>;
    })}
    {locked ? null : <footer className="team-card-foot">
      <span className="team-note ui-caption">{t("team.nothingRuns", { approval: t(`team.approval.${approval}`) })}</span>
      <button type="button" className="team-button team-button-ghost" disabled={busy} onClick={() => void teamAction({ type: "discard", sessionId: session.id })}>{t("team.discard")}</button>
      <button type="button" className="team-button team-button-primary" disabled={busy || !tasks.length || tasks.some(task => !current(task).title.trim())} onClick={() => void start()}>{t("team.start")}</button>
    </footer>}
  </section>;
}

function StatusDot({ view }: { view: TaskView }) {
  return <span className="team-dot" data-view={view} aria-hidden="true" />;
}

function ProgressCard({ session }: { session: Session }) {
  const t = useTranslation();
  const team = session.team!;
  // Status and identity only: streaming helpers would otherwise re-render this card every frame.
  const sessions = useAppStore(selectSessionsMeta);
  const label = useAssigneeLabel();
  const teamAction = useAppStore(state => state.teamAction);
  const selectSession = useAppStore(state => state.selectSession);
  const done = team.tasks.filter(task => task.state === "done").length;
  // Live status reads each helper's latest activity.
  useRetainedTranscripts(team.tasks.map(task => task.workerSessionId));
  return <section className="team-card" aria-label={t("team.title")}>
    <header className="team-card-head"><Users size={14} aria-hidden="true" /><h3 className="ui-control">{team.status === "stopped" ? t("team.stoppedTitle") : t("team.title")}</h3><span className="team-sub ui-caption">{t("team.readyCount", { done, total: team.tasks.length })}</span><span className="team-spacer" />
      {team.status === "running" ? <button type="button" className="team-button" onClick={() => void teamAction({ type: "stop", sessionId: session.id })}><Square size={11} aria-hidden="true" />{t("team.stopAll")}</button> : null}
    </header>
    {team.tasks.map(task => {
      const worker = sessions.find(row => row.id === task.workerSessionId);
      const view = taskView(task, worker);
      const live = [...(worker?.messages ?? [])].reverse().find(message => message.role === "agent")?.activity?.items.filter(item => item.state === "running").at(-1);
      const status = view === "running" ? <span className="team-live">{t(live ? `team.live.${live.kind}` : "team.live.working")}</span>
        : view === "needs" ? <span className="text-warning">{t("team.state.needs")}</span>
        : view === "pending" ? t("team.state.pending", { number: team.tasks.findIndex(row => row.id === task.after) + 1 })
        : view === "done" ? <span className="text-success">{t("team.state.done")}</span>
        : t(`team.state.${view}`);
      return <div key={task.id} className="team-row">
        <StatusDot view={view} />
        <div className="team-what"><p className="team-title ui-control">{task.title}</p><p className="team-sub ui-caption">{label(task.provider, task.model)} · {status}</p></div>
        {worker ? <button type="button" className="team-icon-button" aria-label={`${t("team.open")} · ${task.title}`} onClick={() => void selectSession(worker.id)}><SquareArrowOutUpRight size={13} aria-hidden="true" /></button> : null}
      </div>;
    })}
  </section>;
}

function FinishCard({ session }: { session: Session }) {
  const t = useTranslation();
  const team = session.team!;
  const sessions = useAppStore(state => state.sessions);
  const label = useAssigneeLabel();
  const teamAction = useAppStore(state => state.teamAction);
  const selectSession = useAppStore(state => state.selectSession);
  const [busy, setBusy] = useState(false);
  const finished = team.tasks.filter(task => task.state === "done");
  // Change summaries read each helper's retained turn review.
  useRetainedTranscripts(finished.map(task => task.workerSessionId));
  const merged = finished.filter(task => task.merge === "merged").length;
  const skipped = finished.filter(task => task.merge === "skipped").length;
  const stopped = finished.find(task => task.merge === "conflict" || task.merge === "outOfScope");
  const totals = { files: 0, additions: 0, deletions: 0 };
  for (const task of finished) {
    const change = workerChanges(sessions.find(row => row.id === task.workerSessionId));
    if (change) { totals.files += change.files; totals.additions += change.additions; totals.deletions += change.deletions; }
  }
  const run = async (action: Parameters<typeof teamAction>[0]) => { setBusy(true); try { await teamAction(action); } finally { setBusy(false); } };
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const title = team.status === "done" ? skipped ? t("team.partialTitle", { merged, total: finished.length }) : t("team.doneTitle") : t("team.finishTitle");
  return <section className="team-card" aria-label={title}>
    <header className="team-card-head"><GitMerge size={14} aria-hidden="true" /><h3 className="ui-control">{title}</h3>
      {totals.files ? <span className="team-sub ui-caption">{totals.files === 1 ? t("team.file") : t("team.files", { count: totals.files })} · <span className="text-success">+{totals.additions}</span> <span className="text-danger">−{totals.deletions}</span></span> : null}
      <span className="team-spacer" />
    </header>
    {team.tasks.map(task => {
      const worker = sessions.find(row => row.id === task.workerSessionId);
      const change = workerChanges(worker);
      const isStop = stopped?.id === task.id;
      const mark = task.merge === "merged" ? <Check size={13} aria-hidden="true" className="text-success" /> : task.merge === "skipped" || isStop ? <AlertTriangle size={13} aria-hidden="true" className="text-warning" /> : <StatusDot view={task.state === "done" ? "done" : task.state} />;
      return <div key={task.id} className="team-row-wrap">
        <div className="team-row">
          <span className="team-mark">{mark}</span>
          <div className="team-what"><p className="team-title ui-control">{task.title}</p><p className="team-sub ui-caption">{label(task.provider, task.model)}{change ? <> · {change.files === 1 ? t("team.file") : t("team.files", { count: change.files })} · <span className="text-success">+{change.additions}</span> <span className="text-danger">−{change.deletions}</span></> : null}</p></div>
          {task.state !== "done" ? <span className="team-sub ui-caption">{t("team.notFinished")}</span>
            : task.merge === "merged" ? <span className="text-success ui-caption">{t("team.merged")}</span>
            : task.merge === "skipped" ? <span className="text-warning ui-caption">{t("team.skipped")}</span>
            : worker ? <button type="button" className="team-button team-button-ghost" onClick={() => void selectSession(worker.id)}>{t("team.viewChanges")}</button> : null}
        </div>
        {isStop ? <div className="team-stop ui-caption" role="alert">
          <p className="team-stop-title">{t(task.merge === "outOfScope" ? "team.outsideTitle" : "team.conflictTitle")}</p>
          <p>{task.note ? `${task.note} ` : ""}{t("team.nothingApplied")}</p>
          {task.merge === "conflict" ? <p className="team-resolve-hint">{t("team.resolveHint")}</p> : null}
          <div className="team-actions">
            {task.merge === "conflict" ? <button type="button" className="team-button team-button-primary" disabled={busy} onClick={() => void run({ type: "resolve", sessionId: session.id, taskId: task.id })}>{t("team.resolve")}</button> : null}
            {worker ? <button type="button" className="team-button" onClick={() => void selectSession(worker.id)}>{t("team.viewChanges")}</button> : null}
            <button type="button" className="team-button" disabled={busy} onClick={() => void run({ type: "skip", sessionId: session.id, taskId: task.id })}>{t("team.skip")}</button>
            {task.merge === "outOfScope" ? <button type="button" className="team-button" disabled={busy} onClick={() => void run({ type: "mergeAnyway", sessionId: session.id, taskId: task.id })}>{t("team.mergeAnyway")}</button> : null}
          </div>
        </div> : null}
      </div>;
    })}
    <footer className="team-card-foot">
      <span className="team-note ui-caption">{team.status === "done" ? t(skipped ? "team.partialNote" : "team.doneNote") : t("team.mergeNote")}</span>
      {team.status === "done" || (team.status === "stopped" && !finished.some(task => task.merge !== "merged" && task.merge !== "skipped"))
        // Cleanup is offered only while helper worktrees remain.
        ? (team.tasks.some(task => task.workerSessionId) ? <button type="button" className="team-button" disabled={busy} onClick={() => setConfirmCleanup(true)}>{t("team.cleanup")}</button> : null)
        : <button type="button" className="team-button team-button-primary" disabled={busy || Boolean(stopped)} onClick={() => void run({ type: "merge", sessionId: session.id })}><GitMerge size={12} aria-hidden="true" />{busy ? t("team.merging") : t("team.mergeAll")}</button>}
    </footer>
    <ConfirmDialog open={confirmCleanup} onOpenChange={setConfirmCleanup} title={t("team.cleanup")} description={t("team.cleanupConfirm")} confirmLabel={t("team.cleanup")} onConfirm={() => teamAction({ type: "cleanup", sessionId: session.id, confirm: true })} />
  </section>;
}
