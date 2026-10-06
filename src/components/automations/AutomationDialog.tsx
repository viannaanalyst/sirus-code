import { useEffect, useMemo, useState } from "react";
import type { Automation, AutomationInput, AutomationSchedule, ApprovalMode } from "@/client/types";
import { Checkbox } from "@/components/arc/checkbox/checkbox";
import { DatePicker } from "@/components/arc/date-picker/date-picker";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { Textarea } from "@/components/arc/textarea/textarea";
import { TimePicker } from "@/components/arc/time-picker/time-picker";
import { ModelIcon } from "@/components/ModelIcon";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { INTERVALS, WEEKDAYS } from "@/lib/automations";
import { latestModelChoices, providerModelChoices } from "@/lib/model-registry";
import { supportsPlanning } from "@/lib/execution-options";
import { PROVIDERS, providerById } from "@/lib/provider-registry";
import { isProviderEnabled } from "@/lib/settings";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Switch } from "@/primitives/Switch";
import { useAppStore } from "@/store/app-store";

type Kind = AutomationSchedule["kind"];
/** Radix Select reserves the empty value, so "provider default" needs its own. */
const DEFAULT_MODEL = "__default";
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
  // The newest generation of each model line, plus the saved one (same rule as the model picker).
  const models = useMemo(() => latestModelChoices(providerModelChoices(catalogs, settings, agent, model, ""), model, ""), [catalogs, settings, agent, model]);
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

  const pad = (value: number) => String(value).padStart(2, "0");
  const onceDate = once.slice(0, 10), onceTime = once.slice(11, 16);
  const approvalOptions = approvals.length ? approvals.map((mode) => ({ value: mode, label: t(`automations.approval.${mode}`) })) : [{ value: "ask", label: t("composer.vendorApproval") }];
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
    <DialogContent title={astro ? t(editing ? "astros.habitEdit" : "astros.habitNew", { name: astro.name }) : t(editing ? "automations.edit" : "automations.new")} description={t(astro ? "astros.habitHint" : "automations.dialogHint")} className="automation-dialog w-[min(640px,calc(100vw-32px))]">
      <div className="flex flex-col gap-4">
        <Input label={t("automations.name")} value={name} maxLength={200} onChange={(event) => setName(event.target.value)} placeholder={t("automations.namePlaceholder")} />
        <Textarea label={t("automations.prompt")} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t("automations.promptPlaceholder")} rows={4} />
        <div className="grid grid-cols-2 gap-3">
          <Select label={t("Project")} value={projectId} onValueChange={setProjectId} options={projects.map((project) => ({ value: project.id, label: project.name }))} />
          <Select label={t("automations.workspace")} value={workspace} onValueChange={(value) => setWorkspace(value as "worktree" | "local")} options={[{ value: "worktree", label: t("automations.workspace.worktree") }, { value: "local", label: t("automations.workspace.local") }]} />
          <Select label={t("Provider")} value={agent} onValueChange={(value) => { setAgent(value as typeof agent); setModel(null); }} options={providers.map((provider) => ({ value: provider.id, label: provider.name, icon: <ProviderIcon id={provider.id} size={15} className="bg-transparent" /> }))} />
          <Select label={t("automations.model")} value={model ?? DEFAULT_MODEL} onValueChange={(value) => setModel(value === DEFAULT_MODEL ? null : value)} options={[{ value: DEFAULT_MODEL, label: t("Use provider default"), icon: <ProviderIcon id={agent} size={15} className="bg-transparent" /> }, ...models.map((item) => ({ value: item.model.id, label: item.displayName.replace(/^Claude\s+/i, ""), icon: <ModelIcon modelId={item.model.id} provider={agent} size={15} /> }))]} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label={t("automations.schedule")} value={kind} onValueChange={(value) => setKind(value as Kind)} options={KINDS.map((value) => ({ value, label: t(`automations.schedule.${value}`) }))} />
          {kind === "once" ? <DatePicker label={t("automations.when")} locale={settings.locale} labels={{ clear: t("date.clear"), selected: (date) => t("date.selected", { date }), empty: t("date.choose") }} minDate={new Date(new Date().setHours(0, 0, 0, 0))} value={new Date(`${onceDate}T00:00`)}
            onChange={(date) => { if (date) setOnce(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${onceTime}`); }} /> : null}
          {kind === "once" ? <TimePicker label={t("automations.time")} format="24h" minuteStep={5} value={onceTime} onChange={(value) => setOnce(`${onceDate}T${value}`)} /> : null}
          {kind === "hourly" ? <Select label={t("automations.minute")} value={String(minute)} onValueChange={(value) => setMinute(Number(value))} options={Array.from({ length: 12 }, (_, index) => index * 5).map((value) => ({ value: String(value), label: `:${pad(value)}` }))} /> : null}
          {kind === "interval" ? <Select label={t("automations.every")} value={String(interval)} onValueChange={(value) => setIntervalMinutes(Number(value))} options={INTERVALS.map((value) => ({ value: String(value), label: value % 60 === 0 ? t("automations.summary.everyHours", { hours: value / 60 }) : t("automations.summary.everyMinutes", { minutes: value }) }))} /> : null}
          {kind === "weekly" ? <Select label={t("automations.day")} value={String(weekday)} onValueChange={(value) => setWeekday(Number(value))} options={WEEKDAYS.map((key, index) => ({ value: String(index), label: t(key) }))} /> : null}
          {kind === "daily" || kind === "weekdays" || kind === "weekly" ? <TimePicker label={t("automations.time")} format="24h" minuteStep={5} value={time} onChange={setTime} /> : null}
        </div>
        <Select label={t("automations.permission")} description={t(`automations.approvalHint.${full ? "full" : effectiveApproval === "auto" ? "auto" : "ask"}`)} value={effectiveApproval} onValueChange={(value) => { setApproval(value as ApprovalMode); setAcknowledge(false); }} options={approvalOptions} />
        {full ? <div className="rounded-[10px] border border-[color-mix(in_srgb,var(--warning)_50%,transparent)] p-3"><Checkbox label={t("automations.fullAck")} checked={acknowledge} onCheckedChange={(value) => setAcknowledge(value === true)} /></div> : null}
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
