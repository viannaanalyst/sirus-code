import { useEffect, useMemo, useState } from "react";
import type { Automation, AutomationInput, AutomationSchedule, ApprovalMode } from "@/client/types";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { useTranslation } from "@/i18n/use-translation";
import { INTERVALS, WEEKDAYS } from "@/lib/automations";
import { supportsPlanning } from "@/lib/execution-options";
import { PROVIDERS, providerById } from "@/lib/provider-registry";
import { isProviderEnabled } from "@/lib/settings";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Switch } from "@/primitives/Switch";
import { useAppStore } from "@/store/app-store";

type Kind = AutomationSchedule["kind"];
const KINDS: Kind[] = ["manual", "once", "hourly", "daily", "weekdays", "weekly", "interval"];

function defaultOnce() {
  const at = new Date(Date.now() + 60 * 60_000);
  at.setSeconds(0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** Create or edit one automation. Nothing runs until it is saved enabled. */
export function AutomationDialog({ open, editing, onClose, onSaved, astroId = null }: { open: boolean; editing: Automation | null; onClose: () => void; onSaved: (id: string | null) => void; astroId?: string | null }) {
  const t = useTranslation();
  const allProjects = useAppStore((state) => state.projects);
  const astro = useAppStore((state) => astroId ? state.astros?.find((item) => item.id === astroId) ?? null : null);
  // A habit (ADR-069) runs in one of its Astro's projects.
  const projects = useMemo(() => astro ? allProjects.filter((project) => astro.projectIds.includes(project.id)) : allProjects, [astro, allProjects]);
  const settings = useAppStore((state) => state.settings);
  const installs = useAppStore((state) => state.agents);
  const catalogs = useAppStore((state) => state.modelsByProvider);
  const selectedProjectId = useAppStore((state) => state.selectedProjectId);
  const providers = useMemo(() => PROVIDERS.filter((provider) => isProviderEnabled(settings, provider.id) && installs.some((item) => item.id === provider.id && item.installed)), [settings, installs]);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState("");
  const [agent, setAgent] = useState(settings.defaultAgent);
  const [model, setModel] = useState<string | null>(null);
  const [approval, setApproval] = useState<ApprovalMode>("ask");
  const [planning, setPlanning] = useState(false);
  const [workspace, setWorkspace] = useState<"worktree" | "local">("worktree");
  const [kind, setKind] = useState<Kind>("daily");
  const [time, setTime] = useState("09:00");
  const [minute, setMinute] = useState(0);
  const [weekday, setWeekday] = useState(0);
  const [interval, setIntervalMinutes] = useState(60);
  const [once, setOnce] = useState(defaultOnce);
  const [enabled, setEnabled] = useState(true);
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const source = editing;
    setName(source?.name ?? "");
    setPrompt(source?.prompt ?? "");
    setProjectId(source?.projectId ?? (projects.some((project) => project.id === selectedProjectId) ? selectedProjectId : null) ?? projects[0]?.id ?? "");
    setAgent(source?.agent ?? settings.defaultAgent);
    setModel(source?.model ?? null);
    setApproval(source?.approval ?? "ask");
    setPlanning(source?.planning ?? false);
    // Habit runs are hidden sessions; a new worktree per run would pile up unseen.
    setWorkspace(source?.workspace ?? (astroId ? "local" : "worktree"));
    const schedule = source?.schedule;
    setKind(schedule?.kind ?? "daily");
    setTime(schedule && "time" in schedule ? schedule.time : "09:00");
    setMinute(schedule?.kind === "hourly" ? schedule.minute : 0);
    setWeekday(schedule?.kind === "weekly" ? schedule.weekday : 0);
    setIntervalMinutes(schedule?.kind === "interval" ? schedule.minutes : 60);
    setOnce(schedule?.kind === "once" ? (() => { const at = new Date(schedule.at); const pad = (v: number) => String(v).padStart(2, "0"); return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`; })() : defaultOnce());
    setEnabled(source?.enabled ?? true);
    setAcknowledge(false);
  }, [open, editing, selectedProjectId, projects, settings.defaultAgent, astroId]);

  useEffect(() => { if (open) void useAppStore.getState().loadProviderModels(agent); }, [open, agent]);

  const definition = providerById(agent);
  const models = catalogs[agent]?.models ?? [];
  const planningAvailable = supportsPlanning(agent, model);
  const approvals = (["ask", "auto", "full"] as const).filter((mode) => definition.approvalModes.includes(mode));
  const effectiveApproval = approvals.includes(approval as never) ? approval : approvals[0] ?? "ask";
  const schedule: AutomationSchedule = kind === "manual" ? { kind } : kind === "once" ? { kind, at: new Date(once).toISOString() } : kind === "hourly" ? { kind, minute } : kind === "weekly" ? { kind, weekday, time } : kind === "interval" ? { kind, minutes: interval } : { kind, time };
  const full = effectiveApproval === "full";
  const valid = name.trim() && prompt.trim() && projectId && (!full || (acknowledge && !planning));

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const input: AutomationInput = { id: editing?.id ?? null, name, prompt, projectId, agent, model, approval: effectiveApproval, planning: planning && planningAvailable, workspace, schedule, enabled, acknowledgeFullAccess: full && acknowledge, astroId: astroId ?? editing?.astroId ?? null };
    const before = new Set(useAppStore.getState().automations?.automations.map((item) => item.id) ?? []);
    const snapshot = await useAppStore.getState().automationAction({ type: "upsert", automation: input });
    setBusy(false);
    if (!snapshot) return;
    onSaved(editing?.id ?? snapshot.automations.find((item) => !before.has(item.id))?.id ?? null);
    onClose();
  };

  const field = "flex flex-col gap-1.5";
  const label = "ui-caption text-text-muted";
  const control = "automation-control ui-control";
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
    <DialogContent title={astro ? t(editing ? "astros.habitEdit" : "astros.habitNew", { name: astro.name }) : t(editing ? "automations.edit" : "automations.new")} description={t(astro ? "astros.habitHint" : "automations.dialogHint")} className="w-[min(640px,calc(100vw-32px))]">
      <div className="scroll-thin flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
        <label className={field}><span className={label}>{t("automations.name")}</span><input className={control} value={name} maxLength={200} onChange={(event) => setName(event.target.value)} placeholder={t("automations.namePlaceholder")} /></label>
        <label className={field}><span className={label}>{t("automations.prompt")}</span><textarea className={`${control} min-h-[120px] resize-y py-2`} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t("automations.promptPlaceholder")} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className={field}><span className={label}>{t("Project")}</span><select className={control} value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label className={field}><span className={label}>{t("automations.workspace")}</span><select className={control} value={workspace} onChange={(event) => setWorkspace(event.target.value as "worktree" | "local")}><option value="worktree">{t("automations.workspace.worktree")}</option><option value="local">{t("automations.workspace.local")}</option></select></label>
          <label className={field}><span className={label}>{t("Provider")}</span><select className={control} value={agent} onChange={(event) => { setAgent(event.target.value as typeof agent); setModel(null); }}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
          <label className={field}><span className={label}>{t("automations.model")}</span><select className={control} value={model ?? ""} onChange={(event) => setModel(event.target.value || null)}><option value="">{t("Use provider default")}</option>{models.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={field}><span className={label}>{t("automations.schedule")}</span><select className={control} value={kind} onChange={(event) => setKind(event.target.value as Kind)}>{KINDS.map((value) => <option key={value} value={value}>{t(`automations.schedule.${value}`)}</option>)}</select></label>
          {kind === "once" ? <label className={field}><span className={label}>{t("automations.when")}</span><input type="datetime-local" className={control} value={once} onChange={(event) => setOnce(event.target.value)} /></label> : null}
          {kind === "hourly" ? <label className={field}><span className={label}>{t("automations.minute")}</span><select className={control} value={minute} onChange={(event) => setMinute(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => index * 5).map((value) => <option key={value} value={value}>:{String(value).padStart(2, "0")}</option>)}</select></label> : null}
          {kind === "interval" ? <label className={field}><span className={label}>{t("automations.every")}</span><select className={control} value={interval} onChange={(event) => setIntervalMinutes(Number(event.target.value))}>{INTERVALS.map((value) => <option key={value} value={value}>{value % 60 === 0 ? t("automations.summary.everyHours", { hours: value / 60 }) : t("automations.summary.everyMinutes", { minutes: value })}</option>)}</select></label> : null}
          {kind === "weekly" ? <label className={field}><span className={label}>{t("automations.day")}</span><select className={control} value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>{WEEKDAYS.map((key, index) => <option key={key} value={index}>{t(key)}</option>)}</select></label> : null}
          {kind === "daily" || kind === "weekdays" || kind === "weekly" ? <label className={field}><span className={label}>{t("automations.time")}</span><input type="time" className={control} value={time} onChange={(event) => setTime(event.target.value)} /></label> : null}
        </div>
        <label className={field}><span className={label}>{t("automations.permission")}</span>
          <select className={control} value={effectiveApproval} onChange={(event) => { setApproval(event.target.value as ApprovalMode); setAcknowledge(false); }}>
            {approvals.map((mode) => <option key={mode} value={mode}>{t(`automations.approval.${mode}`)}</option>)}
            {approvals.length === 0 ? <option value="ask">{t("composer.vendorApproval")}</option> : null}
          </select>
          <span className="ui-caption text-text-muted">{t(`automations.approvalHint.${full ? "full" : effectiveApproval === "auto" ? "auto" : "ask"}`)}</span>
        </label>
        {full ? <label className="flex items-start gap-2 rounded-[10px] border border-[color-mix(in_srgb,var(--warning)_50%,transparent)] p-3 ui-control"><input type="checkbox" checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} className="mt-0.5" /><span>{t("automations.fullAck")}</span></label> : null}
        <div className="flex items-center justify-between gap-3 rounded-[10px] border border-border-subtle px-3 py-2.5">
          <div><p className="ui-control text-text-primary">{t("automations.planning")}</p><p className="ui-caption text-text-muted">{t(planningAvailable ? "automations.planningHint" : "automations.planningUnavailable")}</p></div>
          <Switch checked={planning && planningAvailable && !full} disabled={!planningAvailable || full} onChange={setPlanning} />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-[10px] border border-border-subtle px-3 py-2.5">
          <div><p className="ui-control text-text-primary">{t("automations.enabled")}</p><p className="ui-caption text-text-muted">{t("automations.enabledHint")}</p></div>
          <Switch checked={enabled} onChange={setEnabled} />
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <InteractiveButton variant="ghost" disabled={busy} onClick={onClose}>{t("common.cancel")}</InteractiveButton>
        <InteractiveButton loading={busy} disabled={!valid} onClick={() => void save()}>{t(editing ? "common.save" : "automations.create")}</InteractiveButton>
      </div>
    </DialogContent>
  </Dialog>;
}
