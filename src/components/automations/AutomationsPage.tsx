import { useEffect, useState } from "react";
import { Clock3, Pause, Pencil, Play, Plus, Trash2, TriangleAlert } from "@/components/icons/phosphor";
import type { Automation } from "@/client/types";
import { AutomationDialog } from "@/components/automations/AutomationDialog";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { relativeFromNow, runState, scheduleLabel, sortedAutomations } from "@/lib/automations";
import { cn } from "@/lib/cn";
import { providerById } from "@/lib/provider-registry";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";
import "@/styles/automations.css";

/**
 * Automations (ADR-051): the list beside the selected automation's details and
 * run history. Runs are normal sessions; opening one selects it.
 */
export function AutomationsPage() {
  const t = useTranslation();
  const snapshot = useAppStore((state) => state.automations);
  const locale = useAppStore((state) => state.settings.locale);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ editing: Automation | null } | null>(null);
  useEffect(() => { void useAppStore.getState().automationAction({ type: "list" }); }, []);
  const list = snapshot?.automations ?? [];
  const { active, paused } = sortedAutomations(list);
  const current = list.find((item) => item.id === selected) ?? null;

  return <section className="automations-page" aria-label={t("automations.title")}>
    <div className="automations-list-column">
      <h1 className="ui-title px-2 text-text-primary">{t("automations.title")}</h1>
      <button type="button" className="automations-new ui-control" onClick={() => setDialog({ editing: null })}><Plus size={15} />{t("automations.new")}</button>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {snapshot && list.length === 0 ? <p className="px-3 py-6 text-center ui-description text-text-muted">{t("automations.none")}</p> : null}
        {[["automations.active", active], ["automations.paused", paused]].map(([label, items]) => (items as Automation[]).length ? <div key={label as string} className="mb-3">
          <p className="px-3 pb-1 pt-2 ui-caption text-text-muted">{t(label as string)}</p>
          {(items as Automation[]).map((item) => <AutomationRow key={item.id} automation={item} active={item.id === selected} locale={locale} onSelect={() => setSelected(item.id)} />)}
        </div> : null)}
      </div>
    </div>
    <div className="automations-detail-column">
      {current ? <AutomationDetail key={current.id} automation={current} onEdit={() => setDialog({ editing: current })} onDeleted={() => setSelected(null)} />
        : <div className="automations-empty">
          <Clock3 size={30} strokeWidth={1.5} className="text-text-muted" />
          <p className="ui-control text-text-primary">{t("automations.title")}</p>
          <p className="max-w-[360px] ui-description text-text-muted">{t("automations.emptyHint")}</p>
          <InteractiveButton variant="primary" glow={false} onClick={() => setDialog({ editing: null })}>{t("automations.new")}</InteractiveButton>
        </div>}
    </div>
    <AutomationDialog open={dialog !== null} editing={dialog?.editing ?? null} onClose={() => setDialog(null)} onSaved={(id) => { if (id) setSelected(id); }} />
  </section>;
}

function AutomationRow({ automation, active, locale, onSelect }: { automation: Automation; active: boolean; locale: string; onSelect: () => void }) {
  const t = useTranslation();
  const next = relativeFromNow(automation.nextRunAt);
  const subtitle = automation.lastError ? t("automations.lastFailed")
    : !automation.enabled ? t("automations.pausedShort")
      : next?.future ? t("automations.nextIn", { time: next.text }) : scheduleLabel(automation.schedule, t, locale);
  return <button type="button" className={cn("automations-row", active && "automations-row-active")} aria-current={active || undefined} onClick={onSelect}>
    <span className="automations-row-icon"><ProviderIcon id={automation.agent} size={16} /></span>
    <span className="min-w-0 flex-1 text-left">
      <span className="block truncate ui-control text-text-primary">{automation.name}</span>
      <span className={cn("block truncate ui-caption", automation.lastError ? "text-warning" : "text-text-muted")}>{subtitle}</span>
    </span>
  </button>;
}

function AutomationDetail({ automation, onEdit, onDeleted }: { automation: Automation; onEdit: () => void; onDeleted: () => void }) {
  const t = useTranslation();
  const locale = useAppStore((state) => state.settings.locale);
  const runs = useAppStore((state) => state.automations?.runs ?? []);
  const sessions = useAppStore(selectSessionsMeta);
  const project = useAppStore((state) => state.projects.find((item) => item.id === automation.projectId));
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mine = runs.filter((run) => run.automationId === automation.id).slice().reverse();
  const next = relativeFromNow(automation.nextRunAt);
  const last = relativeFromNow(automation.lastRunAt);
  const act = async (action: Parameters<ReturnType<typeof useAppStore.getState>["automationAction"]>[0]) => {
    setBusy(true);
    await useAppStore.getState().automationAction(action);
    setBusy(false);
  };
  const open = (sessionId: string) => {
    const store = useAppStore.getState();
    store.setMainView("session");
    void store.selectSession(sessionId);
  };
  const row = (label: string, value: React.ReactNode) => <div className="flex items-center justify-between gap-4 py-1.5 ui-control"><span className="text-text-muted">{label}</span><span className="min-w-0 truncate text-right text-text-secondary">{value}</span></div>;

  return <div className="automations-detail">
    <header className="automations-detail-header">
      <div className="min-w-0 flex-1">
        <h2 className="truncate ui-title text-text-primary">{automation.name}</h2>
        <p className="ui-caption text-text-muted">{scheduleLabel(automation.schedule, t, locale)}</p>
      </div>
      <InteractiveButton variant="secondary" glow={false} disabled={busy} onClick={() => void act({ type: "runNow", id: automation.id })}><Play size={14} />{t("automations.runNow")}</InteractiveButton>
      <InteractiveButton variant="toolbar" disabled={busy} onClick={() => void act({ type: "setEnabled", id: automation.id, enabled: !automation.enabled })}>{automation.enabled ? <><Pause size={14} />{t("automations.pause")}</> : <><Play size={14} />{t("automations.resume")}</>}</InteractiveButton>
      <InteractiveButton variant="toolbar" disabled={busy} onClick={onEdit}><Pencil size={14} />{t("automations.editShort")}</InteractiveButton>
      <InteractiveButton variant="toolbar" disabled={busy} onClick={() => setConfirmDelete(true)} aria-label={t("automations.delete")}><Trash2 size={14} /></InteractiveButton>
    </header>
    <div className="scroll-thin automations-detail-body">
      {automation.lastError ? <p role="status" className="automations-warning ui-control"><TriangleAlert size={14} className="shrink-0" />{t(automation.lastError)}</p> : null}
      <section className="automations-card">
        {row(t("automations.status"), t(automation.enabled ? "automations.statusActive" : "automations.statusPaused"))}
        {row(t("automations.nextRun"), next?.future ? t("automations.inTime", { time: next.text }) : "—")}
        {row(t("automations.lastRun"), last ? t("automations.agoTime", { time: last.text }) : t("automations.never"))}
      </section>
      <section className="automations-card">
        {row(t("Project"), project?.name ?? "—")}
        {row(t("Provider"), <span className="inline-flex items-center gap-1.5"><ProviderIcon id={automation.agent} size={14} />{providerById(automation.agent).name}{automation.model ? ` · ${automation.model}` : ""}</span>)}
        {row(t("automations.permission"), t(`automations.approval.${automation.approval}`))}
        {row(t("automations.workspace"), t(`automations.workspace.${automation.workspace}`))}
        {row(t("automations.planning"), t(automation.planning ? "Yes" : "No"))}
      </section>
      <section>
        <h3 className="mb-1.5 ui-section-title text-text-muted">{t("automations.prompt")}</h3>
        <p className="selectable whitespace-pre-wrap rounded-[10px] border border-border-subtle px-3 py-2 ui-body text-text-secondary [overflow-wrap:anywhere]">{automation.prompt}</p>
      </section>
      <section>
        <h3 className="mb-1.5 ui-section-title text-text-muted">{t("automations.runs")}</h3>
        {mine.length === 0 ? <p className="ui-description text-text-muted">{t("automations.noRuns")}</p> : <div className="flex flex-col gap-1">
          {mine.map((run) => {
            const state = runState(run, sessions);
            const when = relativeFromNow(run.startedAt);
            const openable = !!run.sessionId && state !== "missing";
            return <button key={run.id} type="button" disabled={!openable} onClick={() => run.sessionId && open(run.sessionId)} className="automations-run">
              <span className={cn("automations-run-dot", `automations-run-${state}`)} />
              <span className="min-w-0 flex-1 truncate text-left ui-control text-text-secondary">{t(`automations.run.${state}`)}{run.manual ? ` · ${t("automations.manualRun")}` : ""}{run.note ? ` · ${t(run.note)}` : ""}</span>
              <span className="shrink-0 ui-caption text-text-muted">{when ? t("automations.agoTime", { time: when.text }) : ""}</span>
            </button>;
          })}
        </div>}
      </section>
    </div>
    <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={t("automations.deleteTitle", { name: automation.name })} description={t("automations.deleteBody")} confirmLabel={t("automations.delete")}
      onConfirm={async () => { const done = await useAppStore.getState().automationAction({ type: "delete", id: automation.id }); if (done) onDeleted(); return !!done; }} />
  </div>;
}
