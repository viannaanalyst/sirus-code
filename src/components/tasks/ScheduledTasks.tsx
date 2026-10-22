import { useEffect, useMemo, useState } from "react";
import type { AgentProviderId, ApprovalMode, ScheduledTask, ScheduledTaskInput, ScheduledTaskWebhookReveal } from "@/client/types";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Check, Clock3, Copy, ExternalLink, Link, MoreHorizontal, Pencil, Play, Plus, RefreshCw, Trash2, X } from "@/components/icons/phosphor";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";
import { PROVIDERS, providerById } from "@/lib/provider-registry";
import { defaultScheduleForm, formToSchedule, MAX_DEDUPE_MINUTES, MAX_WEBHOOK_FILTERS, previewNextRun, relativeIn, scheduleLabel, scheduleToForm, sortScheduledTasks, tasksBoundTo, weekdayNames, type IntervalUnit, type ScheduleForm, type ScheduleKind } from "@/lib/scheduled-tasks";
import { isProviderEnabled } from "@/lib/settings";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/primitives/Dropdown";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { SegmentedControl } from "@/primitives/SegmentedControl";
import { Select } from "@/primitives/Select";
import { Switch } from "@/primitives/Switch";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";
import { useScheduledTasks } from "@/store/scheduled-tasks-store";
import "@/styles/scheduled-tasks.css";

function lowerFirst(text: string, locale: string): string {
  return text.charAt(0).toLocaleLowerCase(locale) + text.slice(1);
}

/** Opens a conversation from the Tasks page. */
function openSession(sessionId: string) {
  const store = useAppStore.getState();
  store.setMainView("session");
  void store.selectSession(sessionId);
}

/**
 * Tasks → Scheduled (ADR-142): every scheduled task with when it runs next, its project,
 * model and last result, an on/off switch and Run now / Edit / Open / Delete.
 */
export function ScheduledTasksView({ editing, onEdit }: { editing: ScheduledTask | "new" | null; onEdit: (task: ScheduledTask | "new" | null) => void }) {
  const t = useTranslation();
  const tasks = useScheduledTasks(state => state.tasks);
  const error = useScheduledTasks(state => state.error);
  const bind = useScheduledTasks(state => state.bind);
  useEffect(() => bind(), [bind]);
  // Next-run labels move with the clock; a minute is enough.
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const sorted = useMemo(() => sortScheduledTasks(tasks ?? []), [tasks]);
  return <div className="scheduled-list">
    {error ? <p role="alert" className="scheduled-error ui-caption">{t(error)}</p> : null}
    {tasks && !tasks.length ? <div className="scheduled-empty">
      <Clock3 size={26} className="text-text-muted" aria-hidden="true" />
      <p className="ui-control text-text-primary">{t("scheduled.emptyTitle")}</p>
      <p className="ui-description max-w-[440px] text-text-muted">{t("scheduled.emptyHint")}</p>
      <InteractiveButton variant="secondary" glow={false} onClick={() => onEdit("new")}><Plus size={14} />{t("scheduled.new")}</InteractiveButton>
    </div> : null}
    {sorted.map(task => <ScheduledRow key={task.id} task={task} now={now} onEdit={() => onEdit(task)} />)}
    {editing ? <ScheduledEditor task={editing === "new" ? null : editing} onClose={() => onEdit(null)} /> : null}
  </div>;
}

function ScheduledRow({ task, now, onEdit }: { task: ScheduledTask; now: number; onEdit: () => void }) {
  const t = useTranslation();
  const locale = useAppStore(state => state.settings.locale);
  const project = useAppStore(state => state.projects.find(item => item.id === task.projectId));
  const catalog = useAppStore(state => state.modelsByProvider[task.agent]);
  const bound = useAppStore(state => task.sessionId ? state.sessions.find(item => item.id === task.sessionId) : undefined);
  const action = useScheduledTasks(state => state.action);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const modelName = task.model ? catalog?.models.find(item => item.id === task.model)?.displayName ?? task.model : providerById(task.agent).name;
  const running = task.lastStatus === "running";
  const webhook = task.schedule.kind === "webhook";
  const next = !task.enabled ? t("scheduled.paused") : webhook ? t("scheduled.waitsWebhook") : task.nextRunAt ? t("scheduled.next", { when: relativeIn(task.nextRunAt, now, t) }) : t("scheduled.noNext");
  const last = task.lastStatus === "never" || !task.lastRunAt ? null
    : running ? { tone: "running", text: t("scheduled.last.running") }
    : { tone: task.lastStatus, text: t(`scheduled.last.${task.lastStatus}`, { when: new Date(task.lastRunAt).toLocaleString(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" }) }) };
  return <article className="scheduled-row" data-enabled={task.enabled || undefined} aria-label={task.title}>
    <span className="scheduled-icon" aria-hidden="true">{webhook ? <Link size={16} /> : <Clock3 size={16} />}</span>
    <button type="button" className="scheduled-body" onClick={onEdit}>
      <span className="scheduled-title ui-control">{task.title}{task.createdBy === "agent" ? <span className="scheduled-chip">{t("scheduled.byAgent")}</span> : null}</span>
      <span className="scheduled-prompt ui-caption">{task.prompt}</span>
      <span className="scheduled-meta">
        <span className="scheduled-chip" data-tone={task.enabled ? "next" : undefined}><Clock3 size={11} aria-hidden="true" />{scheduleLabel(task.schedule, t, locale)} · {next}</span>
        {project ? <span className="scheduled-chip">{project.name}</span> : null}
        <span className="scheduled-chip"><ProviderIcon id={task.agent} size={11} />{modelName}</span>
        {bound ? <span className="scheduled-chip">{t("scheduled.inConversation", { title: bound.title })}</span> : null}
        {last ? <span className="scheduled-chip" data-tone={last.tone} title={task.lastError ?? undefined}>{last.text}</span> : null}
      </span>
      {task.lastError && task.lastStatus === "failed" ? <span className="scheduled-row-error ui-caption">{task.lastError}</span> : null}
    </button>
    <div className="scheduled-side">
      <Switch checked={task.enabled} label={t(task.enabled ? "scheduled.pause" : "scheduled.resume")} onChange={enabled => void action({ type: "setEnabled", id: task.id, enabled })} />
      <Dropdown>
        <DropdownTrigger asChild><button type="button" className="scheduled-more" aria-label={t("scheduled.actions")}><MoreHorizontal size={16} /></button></DropdownTrigger>
        <DropdownContent align="end">
          {webhook ? null : <DropdownItem disabled={running} icon={<Play size={14} />} onSelect={() => void action({ type: "runNow", id: task.id })}>{t("scheduled.runNow")}</DropdownItem>}
          <DropdownItem onSelect={onEdit} icon={<Pencil size={14} />}>{t("scheduled.edit")}</DropdownItem>
          {task.lastSessionId ? <DropdownItem icon={<ExternalLink size={14} />} onSelect={() => openSession(task.lastSessionId!)}>{t("scheduled.openLast")}</DropdownItem> : null}
          <DropdownSeparator />
          <DropdownItem destructive icon={<Trash2 size={14} />} onSelect={() => setConfirmDelete(true)}>{t("scheduled.delete")}</DropdownItem>
        </DropdownContent>
      </Dropdown>
    </div>
    <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={t("scheduled.deleteTitle")} description={t("scheduled.deleteBody", { title: task.title })} confirmLabel={t("scheduled.delete")}
      onConfirm={async () => !!(await action({ type: "delete", id: task.id }))} />
  </article>;
}

const KINDS: ScheduleKind[] = ["once", "daily", "weekly", "interval", "webhook"];
/** The model select's value for "use the provider's default" (a select value cannot be empty). */
const DEFAULT_MODEL = "__default__";
const UNITS: IntervalUnit[] = ["minutes", "hours", "days"];

/** New or edit: name, prompt, project, provider and model, when, where it runs, permissions. */
function ScheduledEditor({ task, onClose }: { task: ScheduledTask | null; onClose: () => void }) {
  const t = useTranslation();
  const locale = useAppStore(state => state.settings.locale);
  const settings = useAppStore(state => state.settings);
  const projects = useAppStore(state => state.projects);
  const installs = useAppStore(state => state.agents);
  const catalogs = useAppStore(state => state.modelsByProvider);
  const sessions = useAppStore(selectSessionsMeta);
  const selectedProjectId = useAppStore(state => state.selectedProjectId);
  const action = useScheduledTasks(state => state.action);
  const [now] = useState(Date.now);
  const providers = useMemo(() => PROVIDERS.filter(provider => isProviderEnabled(settings, provider.id) && installs.some(item => item.id === provider.id && item.installed)), [settings, installs]);
  const [title, setTitle] = useState(task?.title ?? "");
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  const [projectId, setProjectId] = useState(task?.projectId ?? selectedProjectId ?? projects[0]?.id ?? "");
  const [agent, setAgent] = useState<AgentProviderId>(task?.agent ?? settings.defaultAgent);
  const [model, setModel] = useState<string | null>(task?.model ?? null);
  const [form, setForm] = useState<ScheduleForm>(() => task ? scheduleToForm(task.schedule, now) : defaultScheduleForm(now));
  const [sessionId, setSessionId] = useState<string | null>(task?.sessionId ?? null);
  const [approval, setApproval] = useState<ApprovalMode>(task?.approval ?? "ask");
  const [enabled] = useState(task?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A webhook task's URL, shown once after it is made or rotated (ADR-161).
  const reveal = useScheduledTasks(state => state.reveal);
  const [savedId, setSavedId] = useState<string | null>(null);
  const shown = reveal && reveal.taskId === (savedId ?? task?.id) ? reveal : null;
  useEffect(() => () => useScheduledTasks.getState().clearReveal(), []);
  useEffect(() => { void useAppStore.getState().loadProviderModels(agent); }, [agent]);
  const approvals = (["ask", "auto", "full"] as const).filter(mode => providerById(agent).approvalModes.includes(mode));
  const effectiveApproval = approvals.includes(approval as never) ? approval : approvals[0] ?? "ask";
  const projectSessions = useMemo(() => sessions.filter(session => session.projectId === projectId).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).slice(0, 50), [sessions, projectId]);
  const result = formToSchedule(form, Date.now());
  const next = "schedule" in result ? previewNextRun(result.schedule, Date.now()) : null;
  const patch = (value: Partial<ScheduleForm>) => setForm(current => ({ ...current, ...value }));
  const names = weekdayNames(locale, "narrow");
  const control = "tasks-control ui-control";
  const save = async (runNow = false) => {
    if (!("schedule" in result)) { setError(result.error); return; }
    const id = savedId ?? task?.id;
    const input: ScheduledTaskInput = { ...(id ? { id } : {}), title: title.trim() || prompt.trim().split("\n")[0].slice(0, 80), prompt, projectId, agent, model, schedule: result.schedule, sessionId, approval: effectiveApproval, enabled };
    setBusy(true); setError(null);
    const before = useScheduledTasks.getState().reveal;
    const tasks = await action({ type: "upsert", task: input });
    const made = useScheduledTasks.getState().reveal;
    // A new webhook URL stays on screen until the person copies it and closes.
    if (tasks && made && made !== before) { setSavedId(made.taskId); setBusy(false); return; }
    if (tasks && runNow) {
      const saved = task ? task.id : tasks.find(item => item.title === input.title && item.prompt === input.prompt)?.id;
      if (saved) await action({ type: "runNow", id: saved });
    }
    setBusy(false);
    if (tasks) onClose(); else setError(useScheduledTasks.getState().error);
  };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent title={t(task ? "scheduled.editTitle" : "scheduled.newTitle")} description={t("scheduled.editorHelp")} className="scheduled-editor w-[min(600px,calc(100vw-32px))]">
      <div className="scheduled-form">
        <label className="scheduled-field"><span>{t("scheduled.name")}</span><input className={control} value={title} maxLength={200} onChange={event => setTitle(event.target.value)} placeholder={t("scheduled.namePlaceholder")} /></label>
        <label className="scheduled-field"><span>{t("scheduled.prompt")}</span><textarea className={`${control} min-h-[96px] resize-y py-2`} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={t(form.kind === "webhook" ? "scheduled.webhookPromptPlaceholder" : "scheduled.promptPlaceholder")} /></label>
        <div className="grid grid-cols-2 gap-2">
          <div className="scheduled-field"><span>{t("Project")}</span><div className="scheduled-pick"><Select label={t("Project")} className="scheduled-select" value={projectId} onChange={value => { setProjectId(value); setSessionId(null); }} options={projects.map(project => ({ value: project.id, label: project.name }))} /></div></div>
          <div className="scheduled-field"><span>{t("scheduled.model")}</span><span className="flex gap-1.5">
            <div className="scheduled-pick w-[44%]"><Select label={t("Provider")} className="scheduled-select" value={agent} onChange={value => { setAgent(value as AgentProviderId); setModel(null); }} options={providers.map(provider => ({ value: provider.id, label: provider.name }))} /></div>
            <div className="scheduled-pick min-w-0 flex-1"><Select label={t("scheduled.model")} className="scheduled-select" value={model ?? DEFAULT_MODEL} onChange={value => setModel(value === DEFAULT_MODEL ? null : value)} options={[{ value: DEFAULT_MODEL, label: t("Use provider default") }, ...(catalogs[agent]?.models ?? []).map(item => ({ value: item.id, label: item.displayName }))]} /></div>
          </span></div>
        </div>
        <div className="scheduled-field"><span>{t("scheduled.when")}</span>
          <SegmentedControl label={t("scheduled.when")} value={form.kind} onChange={kind => patch({ kind })} options={KINDS.map(kind => ({ value: kind, label: t(`scheduled.kind.${kind}`) }))} />
          {form.kind === "webhook" ? <WebhookFields form={form} patch={patch} taskId={savedId ?? task?.id ?? null} wasWebhook={task?.schedule.kind === "webhook" || savedId != null} shown={shown} /> : null}
          <div className="scheduled-when">
            {form.kind === "once" ? <><input type="date" className={control} value={form.date} onChange={event => patch({ date: event.target.value })} aria-label={t("scheduled.date")} /><input type="time" className={control} value={form.time} onChange={event => patch({ time: event.target.value })} aria-label={t("scheduled.time")} /></> : null}
            {form.kind === "daily" || form.kind === "weekly" ? <input type="time" className={control} value={form.time} onChange={event => patch({ time: event.target.value })} aria-label={t("scheduled.time")} /> : null}
            {form.kind === "interval" ? <><input type="number" min={1} className={`${control} w-[90px]`} value={form.every} onChange={event => patch({ every: Number(event.target.value) })} aria-label={t("scheduled.every")} />
              <SegmentedControl label={t("scheduled.unit")} value={form.unit} onChange={unit => patch({ unit })} options={UNITS.map(unit => ({ value: unit, label: t(`scheduled.unit.${unit}`) }))} /></> : null}
          </div>
          {form.kind === "weekly" ? <div className="scheduled-days" role="group" aria-label={t("scheduled.days")}>{names.map((name, day) =>
            <button key={day} type="button" aria-pressed={form.days.includes(day)} className="scheduled-day" onClick={() => patch({ days: form.days.includes(day) ? form.days.filter(item => item !== day) : [...form.days, day] })}>{name}</button>)}</div> : null}
          {form.kind === "interval" ? <p className="ui-caption text-text-muted">{t("scheduled.intervalHint")}</p> : null}
        </div>
        <div className="scheduled-field"><span>{t("scheduled.where")}</span>
          <div className="scheduled-where">
            <button type="button" aria-pressed={sessionId == null} className="scheduled-option" onClick={() => setSessionId(null)}><b>{t("scheduled.whereNew")}</b><span>{t("scheduled.whereNewHint")}</span></button>
            <button type="button" aria-pressed={sessionId != null} className="scheduled-option" disabled={!projectSessions.length} onClick={() => setSessionId(projectSessions[0]?.id ?? null)}><b>{t("scheduled.whereSame")}</b><span>{t("scheduled.whereSameHint")}</span></button>
          </div>
          {sessionId != null ? <div className="scheduled-pick"><Select label={t("scheduled.conversation")} className="scheduled-select" value={sessionId} onChange={setSessionId} options={projectSessions.map(session => ({ value: session.id, label: session.title }))} /></div> : null}
        </div>
        <div className="scheduled-field"><span>{t("scheduled.permission")}</span>
          <SegmentedControl label={t("scheduled.permission")} value={effectiveApproval} onChange={setApproval} options={approvals.map(mode => ({ value: mode, label: t(`automations.approval.${mode}`) }))} />
          <p className="ui-caption text-text-muted">{t(effectiveApproval === "ask" ? "scheduled.askHint" : "scheduled.fullHint")}</p>
        </div>
        {form.kind === "webhook" && !("error" in result) ? null : <p className={cn("scheduled-next ui-caption", !next && "scheduled-next-off")} role="status">
          <Clock3 size={13} aria-hidden="true" />
          {"error" in result ? t(result.error) : next ? t("scheduled.nextPreview", { when: new Date(next).toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }), label: lowerFirst(scheduleLabel(result.schedule, t, locale), locale) }) : t("scheduled.noNext")}
        </p>}
        {error ? <p role="alert" className="scheduled-error ui-caption">{t(error)}</p> : null}
        <div className="scheduled-actions">
          <InteractiveButton variant="toolbar" onClick={onClose}>{t("common.cancel")}</InteractiveButton>
          <span className="flex-1" />
          {form.kind === "webhook" ? null : <InteractiveButton variant="secondary" glow={false} disabled={busy || !prompt.trim() || !projectId || "error" in result} onClick={() => void save(true)}><Play size={14} />{t("scheduled.saveAndRun")}</InteractiveButton>}
          {shown && savedId ? <InteractiveButton variant="primary" glow={false} onClick={onClose}>{t("scheduled.done")}</InteractiveButton>
            : <InteractiveButton variant="primary" glow={false} loading={busy} disabled={!prompt.trim() || !projectId || "error" in result} onClick={() => void save()}>{t("scheduled.save")}</InteractiveButton>}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}

/** A webhook schedule (ADR-161): filters, the dedupe window and the URL, shown once. */
function WebhookFields({ form, patch, taskId, wasWebhook, shown }: { form: ScheduleForm; patch: (value: Partial<ScheduleForm>) => void; taskId: string | null; wasWebhook: boolean; shown: ScheduledTaskWebhookReveal | null }) {
  const t = useTranslation();
  const action = useScheduledTasks(state => state.action);
  const [copied, setCopied] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const control = "tasks-control ui-control";
  const setFilter = (index: number, value: Partial<ScheduleForm["filters"][number]>) => patch({ filters: form.filters.map((row, at) => at === index ? { ...row, ...value } : row) });
  const copy = (url: string) => { void navigator.clipboard.writeText(url).then(() => setCopied(url)); };
  const rotate = async () => { if (!taskId) return; setRotating(true); await action({ type: "rotateWebhook", id: taskId }); setRotating(false); };
  return <div className="scheduled-webhook">
    <p className="ui-caption text-text-muted">{t("scheduled.webhookHint")}</p>
    <div className="scheduled-field"><span>{t("scheduled.webhookUrl")}</span>
      {shown ? <div className="scheduled-webhook-urls" role="status">
        {shown.urls.map((url, index) => <div key={url} className="scheduled-webhook-url">
          <span className="scheduled-chip">{t(index === 0 && shown.public ? "scheduled.webhookPublic" : "scheduled.webhookLocal")}</span>
          <code className="min-w-0 flex-1 truncate font-mono ui-caption" title={url}>{url}</code>
          <InteractiveButton variant="toolbar" onClick={() => copy(url)} aria-label={`${t("scheduled.webhookCopy")} · ${url}`}>{copied === url ? <Check size={13} /> : <Copy size={13} />}{t(copied === url ? "scheduled.webhookCopied" : "scheduled.webhookCopy")}</InteractiveButton>
        </div>)}
        <p className="ui-caption text-text-muted">{t("scheduled.webhookUrlOnce")}</p>
        {!shown.public ? <p className="ui-caption text-text-muted">{t("scheduled.webhookNoPublic")}</p> : null}
        {!shown.serving ? <p className="scheduled-webhook-warn ui-caption" role="alert">{t("scheduled.webhookOff")}</p> : null}
      </div> : wasWebhook && taskId ? <div className="scheduled-webhook-hidden">
        <p className="ui-caption text-text-muted">{t("scheduled.webhookUrlHidden")}</p>
        <InteractiveButton variant="secondary" glow={false} loading={rotating} onClick={() => void rotate()}><RefreshCw size={13} />{t("scheduled.webhookRotate")}</InteractiveButton>
      </div> : <p className="ui-caption text-text-muted">{t("scheduled.webhookUrlSaved")}</p>}
    </div>
    <div className="scheduled-field"><span>{t("scheduled.filters")}</span>
      {form.filters.map((row, index) => <div key={index} className="scheduled-filter">
        <input className={`${control} min-w-0 flex-1 font-mono`} value={row.path} maxLength={200} placeholder="headers.sentry-hook-resource" aria-label={t("scheduled.filterPath")} onChange={event => setFilter(index, { path: event.target.value })} />
        <span className="ui-caption text-text-muted" aria-hidden="true">=</span>
        <input className={`${control} min-w-0 flex-1`} value={row.equals} maxLength={500} placeholder={t("scheduled.filterEquals")} aria-label={t("scheduled.filterEquals")} onChange={event => setFilter(index, { equals: event.target.value })} />
        <button type="button" className="scheduled-more" aria-label={t("scheduled.filterRemove")} onClick={() => patch({ filters: form.filters.filter((_, at) => at !== index) })}><X size={14} /></button>
      </div>)}
      {form.filters.length < MAX_WEBHOOK_FILTERS ? <span><InteractiveButton variant="toolbar" onClick={() => patch({ filters: [...form.filters, { path: "", equals: "" }] })}><Plus size={13} />{t("scheduled.filterAdd")}</InteractiveButton></span> : null}
      <p className="ui-caption text-text-muted">{t("scheduled.filtersHint")}</p>
    </div>
    <div className="scheduled-field"><span>{t("scheduled.dedupe")}</span>
      <span className="flex items-center gap-2"><input type="number" min={0} max={MAX_DEDUPE_MINUTES} className={`${control} w-[90px]`} value={form.dedupeMinutes} onChange={event => patch({ dedupeMinutes: Number(event.target.value) })} aria-label={t("scheduled.dedupe")} /><span className="ui-caption text-text-muted">{t("scheduled.minutesSuffix")}</span></span>
      <p className="ui-caption text-text-muted">{t("scheduled.dedupeHint")}</p>
    </div>
  </div>;
}

/**
 * Above the composer of a conversation that scheduled tasks continue: "Runs every day at
 * 02:00 · See", opening Tasks → Scheduled. Nothing when no enabled task is bound to it.
 */
export function ScheduledBoundLine({ sessionId }: { sessionId: string }) {
  const t = useTranslation();
  const locale = useAppStore(state => state.settings.locale);
  const tasks = useScheduledTasks(state => state.tasks);
  const bind = useScheduledTasks(state => state.bind);
  useEffect(() => bind(), [bind]);
  const bound = useMemo(() => tasksBoundTo(tasks ?? [], sessionId), [tasks, sessionId]);
  if (!bound.length) return null;
  const first = bound[0];
  const open = () => { const store = useAppStore.getState(); store.setMainView("tasks"); openScheduledTab(); };
  return <div className="scheduled-bound ui-caption" role="note">
    <Clock3 size={13} aria-hidden="true" />
    <span className="min-w-0 truncate">{t("scheduled.boundLine", { label: scheduleLabel(first.schedule, t, locale), title: first.title })}{bound.length > 1 ? ` ${t("scheduled.boundMore", { count: bound.length - 1 })}` : ""}</span>
    <button type="button" className="scheduled-bound-link" onClick={open}>{t("scheduled.see")}</button>
  </div>;
}

/** The Tasks page reads this to open on its Scheduled tab. */
let scheduledTabRequested = false;
function openScheduledTab() { scheduledTabRequested = true; window.dispatchEvent(new Event("sirus:scheduled-tab")); }
export function takeScheduledTabRequest(): boolean { const requested = scheduledTabRequested; scheduledTabRequested = false; return requested; }
