import { useEffect, useMemo, useState } from "react";
import { Bot, ChevronDown, ExternalLink, ListTodo, Trash2, Unlink } from "@/components/icons/phosphor";
import type { ApprovalMode, Task, TaskInput, TaskPriority } from "@/client/types";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";
import { supportsPlanning } from "@/lib/execution-options";
import { PROVIDERS, providerById } from "@/lib/provider-registry";
import { isProviderEnabled } from "@/lib/settings";
import { groupTasks, overdue, PRIORITIES, taskStatus } from "@/lib/tasks";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Switch } from "@/primitives/Switch";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";
import "@/styles/tasks.css";

/**
 * Tasks (ADR-052): a personal to-do list. "Hand to an agent" starts a session
 * with the task's title and notes; the task then reflects that session.
 */
export function TasksPage() {
  const t = useTranslation();
  const tasks = useAppStore((state) => state.tasks);
  const sessions = useAppStore(selectSessionsMeta);
  const projects = useAppStore((state) => state.projects);
  const selectedProjectId = useAppStore((state) => state.selectedProjectId);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showDone, setShowDone] = useState(false);
  useEffect(() => { void useAppStore.getState().taskAction({ type: "list" }); }, []);
  const groups = useMemo(() => groupTasks(tasks ?? [], sessions), [tasks, sessions]);
  const current = tasks?.find((task) => task.id === selected) ?? null;
  const add = async () => {
    const title = draft.trim();
    if (!title) return;
    const before = new Set((useAppStore.getState().tasks ?? []).map((task) => task.id));
    const next = await useAppStore.getState().taskAction({ type: "upsert", task: { id: null, title, notes: "", priority: "none", projectId: selectedProjectId ?? projects[0]?.id ?? null, dueDate: null } });
    if (next) { setDraft(""); setSelected(next.find((task) => !before.has(task.id))?.id ?? null); }
  };

  return <section className="tasks-page" aria-label={t("tasks.title")}>
    <div className={cn("scroll-thin tasks-list-column", current && "tasks-list-narrow")}>
      <div className="tasks-column">
        <h1 className="ui-title px-2 text-text-primary">{t("tasks.title")}</h1>
        {tasks && tasks.length === 0 ? <div className="tasks-empty"><ListTodo size={28} className="text-text-muted" /><p className="ui-control text-text-primary">{t("tasks.emptyTitle")}</p><p className="ui-description text-text-muted">{t("tasks.emptyHint")}</p></div> : null}
        {groups.map((group) => {
          const done = group.key === "tasks.section.done";
          return <section key={group.key} className="mb-3">
            <button type="button" className="tasks-section-label ui-caption" aria-expanded={!done || showDone} onClick={() => done && setShowDone(!showDone)}>
              {done ? <ChevronDown size={12} className={cn("transition-transform", !showDone && "-rotate-90")} /> : null}{t(group.key)}<span className="tabular-nums">{group.tasks.length}</span>
            </button>
            {!done || showDone ? group.tasks.map((task) => <TaskRow key={task.id} task={task} active={task.id === selected} onSelect={() => setSelected(task.id)} />) : null}
          </section>;
        })}
        <form className="tasks-add" onSubmit={(event) => { event.preventDefault(); void add(); }}>
          <span className="tasks-check" aria-hidden="true" />
          <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} placeholder={t("tasks.addPlaceholder")} aria-label={t("tasks.addPlaceholder")} className="min-w-0 flex-1 bg-transparent ui-control text-text-primary outline-none placeholder:text-text-muted" />
        </form>
      </div>
    </div>
    {current ? <div className="tasks-detail-column"><TaskDetail key={current.id} task={current} onClose={() => setSelected(null)} /></div> : null}
  </section>;
}

function TaskRow({ task, active, onSelect }: { task: Task; active: boolean; onSelect: () => void }) {
  const t = useTranslation();
  const sessions = useAppStore(selectSessionsMeta);
  const project = useAppStore((state) => state.projects.find((item) => item.id === task.projectId));
  const status = taskStatus(task, sessions);
  return <div className={cn("tasks-row", active && "tasks-row-active", status === "done" && "opacity-55")}>
    <button type="button" className={cn("tasks-check", status === "done" && "tasks-check-on")} aria-pressed={status === "done"} aria-label={t(status === "done" ? "tasks.markOpen" : "tasks.markDone")}
      onClick={() => void useAppStore.getState().taskAction({ type: "setDone", id: task.id, done: status !== "done" })} />
    <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onSelect}>
      {task.priority !== "none" ? <span className={cn("tasks-priority", `tasks-priority-${task.priority}`)} title={t(`tasks.priority.${task.priority}`)} /> : null}
      <span className={cn("min-w-0 flex-1 truncate ui-control text-text-primary", status === "done" && "line-through")}>{task.title}</span>
      {status !== "todo" && status !== "done" ? <span className={cn("tasks-status ui-caption", `tasks-status-${status}`)}>{t(`tasks.status.${status}`)}</span> : null}
      {task.dueDate ? <span className={cn("ui-caption tabular-nums", overdue(task) ? "text-danger" : "text-text-muted")}>{task.dueDate.slice(5).split("-").reverse().join("/")}</span> : null}
      {project ? <span className="max-w-[120px] truncate ui-caption text-text-muted">{project.name}</span> : null}
    </button>
  </div>;
}

function TaskDetail({ task, onClose }: { task: Task; onClose: () => void }) {
  const t = useTranslation();
  const projects = useAppStore((state) => state.projects);
  const settings = useAppStore((state) => state.settings);
  const installs = useAppStore((state) => state.agents);
  const catalogs = useAppStore((state) => state.modelsByProvider);
  const sessions = useAppStore(selectSessionsMeta);
  const [form, setForm] = useState<TaskInput>({ id: task.id, title: task.title, notes: task.notes, priority: task.priority, projectId: task.projectId, dueDate: task.dueDate });
  const providers = useMemo(() => PROVIDERS.filter((provider) => isProviderEnabled(settings, provider.id) && installs.some((item) => item.id === provider.id && item.installed)), [settings, installs]);
  const [agent, setAgent] = useState(settings.defaultAgent);
  const [model, setModel] = useState<string | null>(null);
  const [approval, setApproval] = useState<ApprovalMode>("ask");
  const [planning, setPlanning] = useState(false);
  const [isolated, setIsolated] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { void useAppStore.getState().loadProviderModels(agent); }, [agent]);
  const status = taskStatus(task, sessions);
  const linked = task.sessionId ? sessions.find((session) => session.id === task.sessionId) : undefined;
  const dirty = form.title !== task.title || form.notes !== task.notes || form.priority !== task.priority || form.projectId !== task.projectId || form.dueDate !== task.dueDate;
  const save = async (next = form) => { if (next.title.trim()) await useAppStore.getState().taskAction({ type: "upsert", task: next }); };
  const change = (patch: Partial<TaskInput>, immediate = false) => { const next = { ...form, ...patch }; setForm(next); if (immediate) void save(next); };
  const approvals = (["ask", "auto", "full"] as const).filter((mode) => providerById(agent).approvalModes.includes(mode));
  const effectiveApproval = approvals.includes(approval as never) ? approval : approvals[0] ?? "ask";
  const planningAvailable = supportsPlanning(agent, model) && effectiveApproval !== "full";
  const delegate = async () => {
    setBusy(true);
    if (dirty) await save();
    const next = await useAppStore.getState().taskAction({ type: "delegate", id: task.id, agent, model, approval: effectiveApproval, planning: planning && planningAvailable, isolatedWorktree: isolated });
    setBusy(false);
    const sessionId = next?.find((item) => item.id === task.id)?.sessionId;
    if (sessionId) { const store = useAppStore.getState(); store.setMainView("session"); void store.selectSession(sessionId); }
  };
  const control = "tasks-control ui-control";

  return <div className="tasks-detail">
    <div className="flex items-center gap-2">
      <input value={form.title} onChange={(event) => change({ title: event.target.value })} onBlur={() => { if (dirty) void save(); }} maxLength={500} aria-label={t("tasks.titleLabel")} className="min-w-0 flex-1 bg-transparent ui-title text-text-primary outline-none" />
      <InteractiveButton variant="toolbar" onClick={onClose}>{t("common.close")}</InteractiveButton>
    </div>
    <textarea value={form.notes} onChange={(event) => change({ notes: event.target.value })} onBlur={() => { if (dirty) void save(); }} placeholder={t("tasks.notesPlaceholder")} aria-label={t("tasks.notes")} className={`${control} min-h-[120px] resize-y py-2`} />
    <div className="grid grid-cols-3 gap-2">
      <label className="flex flex-col gap-1"><span className="ui-caption text-text-muted">{t("tasks.priority")}</span><select className={control} value={form.priority} onChange={(event) => change({ priority: event.target.value as TaskPriority }, true)}>{PRIORITIES.map((value) => <option key={value} value={value}>{t(`tasks.priority.${value}`)}</option>)}</select></label>
      <label className="flex flex-col gap-1"><span className="ui-caption text-text-muted">{t("Project")}</span><select className={control} value={form.projectId ?? ""} onChange={(event) => change({ projectId: event.target.value || null }, true)}><option value="">{t("tasks.noProject")}</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label className="flex flex-col gap-1"><span className="ui-caption text-text-muted">{t("tasks.due")}</span><input type="date" className={control} value={form.dueDate ?? ""} onChange={(event) => change({ dueDate: event.target.value || null }, true)} /></label>
    </div>
    {linked ? <div className="tasks-card">
      <div className="flex items-center gap-2"><ProviderIcon id={linked.agent} size={16} /><span className="min-w-0 flex-1 truncate ui-control text-text-primary">{linked.title}</span><span className={cn("tasks-status ui-caption", `tasks-status-${status}`)}>{t(`tasks.status.${status}`)}</span></div>
      <div className="mt-2 flex gap-1.5">
        <InteractiveButton variant="secondary" glow={false} onClick={() => { const store = useAppStore.getState(); store.setMainView("session"); void store.selectSession(linked.id); }}><ExternalLink size={14} />{t("tasks.openChat")}</InteractiveButton>
        <InteractiveButton variant="toolbar" onClick={() => void useAppStore.getState().taskAction({ type: "unlink", id: task.id })}><Unlink size={14} />{t("tasks.unlink")}</InteractiveButton>
      </div>
    </div> : null}
    {status !== "running" && status !== "needs" ? <div className="tasks-card">
      <p className="mb-2 ui-control text-text-primary">{t("tasks.handOff")}</p>
      <div className="grid grid-cols-2 gap-2">
        <select className={control} value={agent} aria-label={t("Provider")} onChange={(event) => { setAgent(event.target.value as typeof agent); setModel(null); }}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select>
        <select className={control} value={model ?? ""} aria-label={t("automations.model")} onChange={(event) => setModel(event.target.value || null)}><option value="">{t("Use provider default")}</option>{(catalogs[agent]?.models ?? []).map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select>
        <select className={control} value={effectiveApproval} aria-label={t("automations.permission")} onChange={(event) => setApproval(event.target.value as ApprovalMode)}>{approvals.map((mode) => <option key={mode} value={mode}>{t(`automations.approval.${mode}`)}</option>)}</select>
        <select className={control} value={isolated ? "worktree" : "local"} aria-label={t("automations.workspace")} onChange={(event) => setIsolated(event.target.value === "worktree")}><option value="worktree">{t("automations.workspace.worktree")}</option><option value="local">{t("automations.workspace.local")}</option></select>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3"><span className="ui-caption text-text-muted">{t("automations.planning")}</span><Switch checked={planning && planningAvailable} disabled={!planningAvailable} onChange={setPlanning} /></div>
      <div className="mt-3 flex items-center gap-2">
        <InteractiveButton variant="primary" glow={false} loading={busy} disabled={!form.projectId || !form.title.trim()} onClick={() => void delegate()}><Bot size={14} />{t(linked ? "tasks.handOffAgain" : "tasks.handOffButton")}</InteractiveButton>
        {!form.projectId ? <span className="ui-caption text-text-muted">{t("tasks.needsProject")}</span> : null}
      </div>
    </div> : null}
    <div className="flex items-center gap-2">
      <InteractiveButton variant="secondary" glow={false} onClick={() => void useAppStore.getState().taskAction({ type: "setDone", id: task.id, done: !task.completedAt })}>{t(task.completedAt ? "tasks.markOpen" : "tasks.markDone")}</InteractiveButton>
      <span className="flex-1" />
      <InteractiveButton variant="toolbar" onClick={() => setConfirmDelete(true)}><Trash2 size={14} />{t("tasks.delete")}</InteractiveButton>
    </div>
    <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={t("tasks.deleteTitle")} description={t("tasks.deleteBody")} confirmLabel={t("tasks.delete")}
      onConfirm={async () => { const next = await useAppStore.getState().taskAction({ type: "delete", id: task.id }); if (next) onClose(); return !!next; }} />
  </div>;
}
