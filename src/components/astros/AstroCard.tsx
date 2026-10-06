import { useState } from "react";
import type { AutomationSchedule, Session } from "@/client/types";
import { ChevronRight, Check, Clock3, GitPullRequest, MessagesSquare } from "@/components/icons/phosphor";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { scheduleLabel } from "@/lib/automations";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { StatusIndicator } from "@/primitives/StatusIndicator";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";

/**
 * Interactive cards an Astro writes as fenced `sirus-card` JSON blocks (ADR-069):
 * a live session, a pull request, reply choices or a habit suggestion.
 */
type Card =
  | { type: "session"; id: string }
  | { type: "pr"; repo: string; number: number; title?: string }
  | { type: "choices"; prompt?: string; options: string[] }
  | { type: "habit"; name: string; prompt: string; schedule: AutomationSchedule; project?: string };

/** Keeps only the fields each schedule kind takes; models often add extras (a weekday on "weekdays"). */
function normalizeSchedule(value: unknown): AutomationSchedule | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const time = typeof raw.time === "string" && /^\d{2}:\d{2}$/.test(raw.time) ? raw.time : "09:00";
  const weekday = Number.isInteger(raw.weekday) && (raw.weekday as number) >= 0 && (raw.weekday as number) <= 6 ? raw.weekday as number : null;
  switch (raw.kind) {
    case "hourly": return { kind: "hourly", minute: Number.isInteger(raw.minute) ? Math.min(59, Math.max(0, raw.minute as number)) : 0 };
    case "daily": return { kind: "daily", time };
    case "weekdays": return weekday === null ? { kind: "weekdays", time } : { kind: "weekly", weekday, time };
    case "weekly": return { kind: "weekly", weekday: weekday ?? 0, time };
    default: return null;
  }
}

function parse(source: string): Card[] {
  try {
    const value: unknown = JSON.parse(source);
    const list = Array.isArray(value) ? value : [value];
    return list.filter((item): item is Card => {
      if (!item || typeof item !== "object") return false;
      const card = item as Record<string, unknown>;
      if (card.type === "session") return typeof card.id === "string";
      if (card.type === "pr") return typeof card.repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(card.repo) && Number.isInteger(card.number);
      if (card.type === "choices") return Array.isArray(card.options) && card.options.every((option) => typeof option === "string") && card.options.length > 0;
      if (card.type === "habit") {
        const schedule = normalizeSchedule(card.schedule);
        if (!schedule || typeof card.name !== "string" || typeof card.prompt !== "string") return false;
        card.schedule = schedule;
        return true;
      }
      return false;
    }).slice(0, 12);
  } catch { return []; }
}

export function AstroCards({ source, session, settled }: { source: string; session: Session; settled: boolean }) {
  const cards = parse(source);
  if (!cards.length) return null;
  return <div className="my-2 flex flex-col gap-2">
    {cards.map((card, index) => card.type === "session" ? <SessionCard key={index} id={card.id} />
      : card.type === "pr" ? <PullRequestCard key={index} card={card} />
      : card.type === "choices" ? <ChoicesCard key={index} card={card} session={session} settled={settled} />
      : <HabitCard key={index} card={card} session={session} />)}
  </div>;
}

function SessionCard({ id }: { id: string }) {
  const t = useTranslation();
  const target = useAppStore((state) => selectSessionsMeta(state).find((session) => session.id === id) ?? null);
  const project = useAppStore((state) => target ? state.projects.find((item) => item.id === target.projectId)?.name : undefined);
  if (!target) return <div className="astro-card ui-caption text-text-muted">{t("astros.card.sessionGone")}</div>;
  return <button type="button" className="astro-card astro-card-link" onClick={() => void useAppStore.getState().selectSession(target.id)}>
    <ProviderIcon id={target.agent} size={16} />
    <span className="min-w-0 flex-1 text-left">
      <span className="block truncate ui-control text-text-primary">{target.title}</span>
      <span className="block truncate ui-caption text-text-muted">{project} · {target.worktree.branch}</span>
    </span>
    <StatusIndicator status={target.status} />
    <ChevronRight size={13} className="text-text-muted" />
  </button>;
}

function PullRequestCard({ card }: { card: Extract<Card, { type: "pr" }> }) {
  return <button type="button" className="astro-card astro-card-link" onClick={() => {
    useAppStore.setState({ pullsSelection: `${card.repo}#${card.number}` });
    useAppStore.getState().setMainView("pulls");
  }}>
    <GitPullRequest size={16} className="text-text-muted" />
    <span className="min-w-0 flex-1 text-left">
      <span className="block truncate ui-control text-text-primary">{card.title ?? `#${card.number}`}</span>
      <span className="block truncate ui-caption text-text-muted">{card.repo} #{card.number}</span>
    </span>
    <ChevronRight size={13} className="text-text-muted" />
  </button>;
}

function ChoicesCard({ card, session, settled }: { card: Extract<Card, { type: "choices" }>; session: Session; settled: boolean }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const busy = ["starting", "running", "waiting"].includes(session.status);
  return <div className="astro-card flex-col items-stretch">
    {card.prompt ? <p className="ui-control text-text-secondary"><MessagesSquare size={13} className="mr-1.5 inline" />{card.prompt}</p> : null}
    <div className="flex flex-wrap gap-1.5">
      {card.options.slice(0, 6).map((option) => <InteractiveButton key={option} variant="toolbar" disabled={!settled || busy || chosen !== null}
        onClick={() => { setChosen(option); void useAppStore.getState().sendPrompt(option, undefined, session.id).then((ok) => { if (!ok) setChosen(null); }); }}>
        {chosen === option ? <Check size={12} /> : null}{option}
      </InteractiveButton>)}
    </div>
  </div>;
}

function HabitCard({ card, session }: { card: Extract<Card, { type: "habit" }>; session: Session }) {
  const t = useTranslation();
  const locale = useAppStore((state) => state.settings.locale);
  const astro = useAppStore((state) => state.astros?.find((item) => item.id === session.astro) ?? null);
  const projects = useAppStore((state) => state.projects);
  const existing = useAppStore((state) => state.automations?.automations.some((item) => item.astroId === session.astro && item.name === card.name) ?? false);
  const [state, setState] = useState<"idle" | "busy" | "done" | "dismissed">("idle");
  if (!astro || state === "dismissed") return null;
  const project = projects.find((item) => astro.projectIds.includes(item.id) && (!card.project || item.name === card.project || item.id === card.project)) ?? null;
  const create = async () => {
    if (!project) return;
    setState("busy");
    const store = useAppStore.getState();
    const snapshot = await store.automationAction({ type: "upsert", automation: {
      id: null, name: card.name.slice(0, 200), prompt: card.prompt, projectId: project.id, agent: session.agent, model: session.model ?? null,
      approval: session.execution?.approval ?? "ask", planning: false, workspace: "local", schedule: card.schedule, enabled: true, acknowledgeFullAccess: false, astroId: astro.id,
    } });
    setState(snapshot ? "done" : "idle");
  };
  const done = state === "done" || existing;
  const when = (() => { try { return scheduleLabel(card.schedule, t, locale); } catch { return ""; } })();
  return <div className="astro-card flex-col items-stretch">
    <p className="flex items-center gap-1.5 ui-control text-text-primary"><Clock3 size={13} />{done ? t("astros.card.habitCreated") : t("astros.card.habitSuggestion")}</p>
    <p className="ui-caption text-text-secondary">{card.name}{when ? ` · ${when}` : ""}{project ? ` · ${project.name}` : ""}</p>
    {done ? null : <div className="flex gap-1.5">
      <InteractiveButton disabled={!project} loading={state === "busy"} onClick={() => void create()}>{t("astros.card.createHabit")}</InteractiveButton>
      <InteractiveButton variant="ghost" onClick={() => setState("dismissed")}>{t("astros.card.notNow")}</InteractiveButton>
    </div>}
  </div>;
}
