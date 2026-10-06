import { useEffect, useState } from "react";
import type { Astro, Automation } from "@/client/types";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { AutomationDialog } from "@/components/automations/AutomationDialog";
import { AstroIcon } from "@/components/astros/AstroArt";
import { Pencil, Play, Plus, Trash2 } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { runState, scheduleLabel } from "@/lib/automations";
import { cn } from "@/lib/cn";
import { IconButton } from "@/primitives/IconButton";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Switch } from "@/primitives/Switch";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";

/** An Astro's memory and habits (ADR-069). */
export function AstroPanel() {
  const t = useTranslation();
  const panel = useAppStore((state) => state.astroPanel);
  const astro = useAppStore((state) => panel ? state.astros?.find((item) => item.id === panel.astroId) ?? null : null);
  const close = () => useAppStore.getState().setAstroPanel(null);
  return <Dialog open={Boolean(panel && astro)} onOpenChange={(open) => { if (!open) close(); }}>
    {astro && panel ? <DialogContent title={astro.name} description={t("astros.details")} className="w-[min(640px,calc(100vw-32px))]">
      <div className="astro-panel" style={{ "--astro": astro.color } as React.CSSProperties}>
        <div className="astro-panel-tabs" role="tablist">
          <span className="mr-2"><AstroIcon icon={astro.icon} style={astro.style} color={astro.color} size={26} /></span>
          {(["memory", "habits"] as const).map((tab) => <button key={tab} type="button" role="tab" aria-selected={panel.tab === tab} className="astro-panel-tab ui-control"
            onClick={() => useAppStore.getState().setAstroPanel({ astroId: astro.id, tab })}>{t(tab === "memory" ? "astros.memory" : "astros.habits")}</button>)}
        </div>
        {panel.tab === "memory" ? <MemoryTab astro={astro} /> : <HabitsTab astro={astro} />}
      </div>
    </DialogContent> : null}
  </Dialog>;
}

function MemoryTab({ astro }: { astro: Astro }) {
  const t = useTranslation();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const store = useAppStore.getState;
  const add = async () => {
    if (!text.trim()) return;
    await store().astroMemory({ type: "remember", id: astro.id, text });
    setText("");
  };
  return <div className="flex flex-col gap-3">
    <p className="ui-caption text-text-muted">{t("astros.memoryHint")}</p>
    <div className="flex gap-2">
      <input className="automation-control ui-control flex-1" value={text} maxLength={400} placeholder={t("astros.memoryPlaceholder")} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void add(); }} />
      <InteractiveButton disabled={!text.trim()} onClick={() => void add()}>{t("astros.remember")}</InteractiveButton>
    </div>
    <div className="scroll-thin flex max-h-[46vh] flex-col gap-1.5 overflow-y-auto">
      {astro.memory.length === 0 ? <p className="py-4 text-center ui-caption text-text-muted">{t("astros.memoryEmpty")}</p> : null}
      {astro.memory.map((fact) => <div key={fact.id} className="astro-fact">
        <time className="ui-caption tabular-nums text-text-muted">{new Date(fact.createdAt).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" })}</time>
        {editing?.id === fact.id ? <input autoFocus className="automation-control ui-control flex-1" value={editing.text} maxLength={400}
          onChange={(event) => setEditing({ id: fact.id, text: event.target.value })}
          onKeyDown={(event) => { if (event.key === "Enter" && editing.text.trim()) { void store().astroMemory({ type: "editFact", id: astro.id, factId: fact.id, text: editing.text }); setEditing(null); } if (event.key === "Escape") { event.stopPropagation(); setEditing(null); } }}
          onBlur={() => setEditing(null)} />
          : <span className="min-w-0 flex-1 ui-control text-text-secondary">{fact.text}</span>}
        <IconButton label={t("astros.editItem")} onClick={() => setEditing({ id: fact.id, text: fact.text })}><Pencil size={13} /></IconButton>
        <IconButton label={t("astros.forget")} onClick={() => void store().astroMemory({ type: "forget", id: astro.id, factId: fact.id })}><Trash2 size={13} /></IconButton>
      </div>)}
    </div>
  </div>;
}

function HabitsTab({ astro }: { astro: Astro }) {
  const t = useTranslation();
  const locale = useAppStore((state) => state.settings.locale);
  const snapshot = useAppStore((state) => state.automations);
  const sessions = useAppStore(selectSessionsMeta);
  const [dialog, setDialog] = useState<{ editing: Automation | null } | null>(null);
  useEffect(() => { if (!useAppStore.getState().automations) void useAppStore.getState().automationAction({ type: "list" }); }, []);
  const habits = (snapshot?.automations ?? []).filter((automation) => automation.astroId === astro.id);
  const action = useAppStore.getState().automationAction;
  return <div className="flex flex-col gap-3">
    <p className="ui-caption text-text-muted">{t("astros.habitsHint")}</p>
    <div className="scroll-thin flex max-h-[46vh] flex-col gap-2 overflow-y-auto">
      {habits.length === 0 ? <p className="py-4 text-center ui-caption text-text-muted">{t("astros.habitsEmpty")}</p> : null}
      {habits.map((habit) => {
        const runs = (snapshot?.runs ?? []).filter((run) => run.automationId === habit.id).slice(-20);
        return <div key={habit.id} className="astro-habit">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate ui-control text-text-primary">{habit.name}</p>
            <Switch checked={habit.enabled} onChange={(enabled) => void action({ type: "setEnabled", id: habit.id, enabled })} />
          </div>
          <p className="ui-caption text-text-muted">{scheduleLabel(habit.schedule, t, locale)}{habit.lastError ? ` · ${habit.lastError}` : ""}</p>
          {runs.length ? <div className="flex items-center gap-[3px]" aria-label={t("astros.lastRuns")}>
            {runs.map((run) => { const state = runState(run, sessions); return <i key={run.id} title={`${new Date(run.startedAt).toLocaleString()} · ${state}`} className={cn("astro-run", `astro-run-${state}`)} />; })}
          </div> : null}
          <div className="flex gap-1.5">
            <InteractiveButton variant="toolbar" onClick={() => void action({ type: "runNow", id: habit.id })}><Play size={12} />{t("astros.runNow")}</InteractiveButton>
            <InteractiveButton variant="toolbar" onClick={() => setDialog({ editing: habit })}><Pencil size={12} />{t("astros.editItem")}</InteractiveButton>
            <InteractiveButton variant="toolbar" onClick={() => void action({ type: "delete", id: habit.id })}><Trash2 size={12} />{t("astros.deleteItem")}</InteractiveButton>
          </div>
        </div>;
      })}
    </div>
    <InteractiveButton variant="toolbar" className="self-start" onClick={() => setDialog({ editing: null })}><Plus size={13} />{t("astros.addHabit")}</InteractiveButton>
    <AutomationDialog open={dialog !== null} editing={dialog?.editing ?? null} astroId={astro.id} onClose={() => setDialog(null)} onSaved={() => undefined} />
  </div>;
}
