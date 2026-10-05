import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Bot, Check, ChevronDown, CircleHelp, FilePenLine, Search, Square, Terminal, Wrench, X } from "@/components/icons/phosphor";
import type { ActivityItem, ActivityKind, ActivityStep, TurnActivity } from "@/client/types";
import { modelDisplayName } from "@/lib/model-registry";
import { useAppStore } from "@/store/app-store";
import { providerById } from "@/lib/providers";
import { activityElapsed, formatActivityDuration, isActivityActive } from "@/lib/agent-activity";
import { useTranslation } from "@/i18n/use-translation";
import { useArcReducedMotion } from "@/components/arc/lib/use-arc-motion";
import { useAmbientActive } from "@/lib/ambient-motion";

/** Steps kept visible on the trail; earlier ones fold behind one control. */
const VISIBLE_STEPS = 7;
const kindIcons: Record<ActivityKind, typeof Search> = { read: Search, edit: FilePenLine, command: Terminal, tool: Wrench, agent: Bot };
const stateLabels = { running: "status.running", completed: "status.completed", failed: "status.failed", stopped: "status.stopped", unknown: "Not reported" } as const;

/** The spinning world: a planet with a tilted ring; its satellite only travels while the turn is live. */
function ActivityOrbit({ moving, slow }: { moving: boolean; slow: boolean }) {
  return <svg className="activity-orbit" viewBox="0 0 24 24" aria-hidden="true">
    {/* The tilt lives on the group so the ring's own settle animation never replaces it. */}
    <g transform="rotate(-28 12 12)"><ellipse className="activity-orbit-ring" cx="12" cy="12" rx="10.5" ry="4.4" /></g>
    <circle className="activity-orbit-core" cx="12" cy="12" r="3.6" />
    <g transform="rotate(-28 12 12)">
      {moving
        ? <circle className="activity-orbit-satellite" r="2"><animateMotion dur={slow ? "5s" : "1.6s"} repeatCount="indefinite" path="M1.5,12 a10.5,4.4 0 1,1 21,0 a10.5,4.4 0 1,1 -21,0" /></circle>
        : <circle className="activity-orbit-satellite" cx="22.5" cy="12" r="2" />}
    </g>
  </svg>;
}

/** A child's own small world, tinted per name while it works. */
function ChildOrbit({ moving }: { moving: boolean }) {
  return <svg className="activity-child-orbit" viewBox="0 0 24 24" aria-hidden="true">
    <g transform="rotate(-28 12 12)"><ellipse fill="none" stroke="currentColor" strokeWidth="1.6" cx="12" cy="12" rx="10.5" ry="4.4" /></g>
    <circle fill="currentColor" cx="12" cy="12" r="3.6" />
    <g transform="rotate(-28 12 12)">
      {moving
        ? <circle fill="currentColor" r="2"><animateMotion dur="1.6s" repeatCount="indefinite" path="M1.5,12 a10.5,4.4 0 1,1 21,0 a10.5,4.4 0 1,1 -21,0" /></circle>
        : null}
    </g>
  </svg>;
}

/** Stable tint per child name from existing palette tokens, so a helper keeps its color across turns. */
const childTints = ["var(--brand-openai)", "var(--brand-cursor)", "var(--brand-nebula)", "var(--brand-gemini)", "var(--success)", "var(--brand-claude)"];
export function childTint(name: string): string {
  let hash = 7;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return childTints[hash % childTints.length];
}
const liveStepLabels: Record<ActivityKind, string> = { read: "Reading or searching…", edit: "Editing files…", command: "Running a command…", tool: "Using a tool…", agent: "Delegating a task…" };

function ChildRow({ item, name, modelLabel, now, moving }: { item: ActivityItem; name: string; modelLabel: (id: string) => string; now: number; moving: boolean }) {
  const t = useTranslation();
  const stepsId = useId();
  // A failed child opens itself so the failing step is visible without a click.
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? item.state === "failed";
  const steps = item.steps ?? [];
  const count = steps.length + (item.hiddenSteps ?? 0);
  const running = item.state === "running";
  const current = [...steps].reverse().find(step => step.state === "running");
  const duration = item.startedAt ? formatActivityDuration(Math.floor(((item.endedAt ?? now) - item.startedAt) / 1000)) : null;
  return <li className="activity-step activity-child" data-state={item.state} data-kind="agent" style={{ "--child-tint": childTint(name) } as CSSProperties}>
    <button type="button" className="activity-child-head" aria-expanded={expanded} aria-controls={stepsId} onClick={() => setOpen(!expanded)}>
      <ChildOrbit moving={running && moving} />
      <span className="activity-child-name">{name}</span>
      {item.model ? <span className="activity-child-model ui-micro">{modelLabel(item.model)}</span> : <span className="sr-only">{t("subagent")}</span>}
      <span className="activity-child-meta ui-micro">
        {count ? <span>{t(count === 1 ? "{count} step" : "{count} steps", { count })}</span> : null}
        {duration ? <span className="activity-duration">{duration}</span> : null}
        <StepStatus item={item} />
        <ChevronDown size={12} className={expanded ? "activity-chevron expanded" : "activity-chevron"} aria-hidden="true" />
      </span>
    </button>
    {running && !expanded ? <span className="activity-child-now">{t(current ? liveStepLabels[current.kind] : steps.length ? "Thinking…" : "Starting")}</span> : null}
    {expanded ? <ol id={stepsId} className="activity-child-steps">
      {item.hiddenSteps ? <li className="activity-child-folded ui-micro">{t("+{count} earlier steps", { count: item.hiddenSteps })}</li> : null}
      {steps.map(step => <ChildStepRow key={step.id} step={step} />)}
      {!steps.length ? <li className="activity-child-folded ui-micro">{t("Child activity reported by the provider. Controls remain with the parent session.")}</li> : null}
    </ol> : null}
  </li>;
}

function ChildStepRow({ step }: { step: ActivityStep }) {
  const t = useTranslation();
  const Icon = kindIcons[step.kind];
  return <li className="activity-child-step" data-state={step.state}>
    <Icon size={12} className="activity-step-icon" aria-hidden="true" />
    <span className="activity-step-label">{t(step.label || "Tool call")}</span>
    <StepStatus item={step} />
  </li>;
}

function StepStatus({ item }: { item: Pick<ActivityItem, "state"> }) {
  const t = useTranslation();
  const label = t(stateLabels[item.state]);
  if (item.state === "running") return <span className="activity-step-status" data-state="running" role="img" aria-label={label}><span className="activity-step-pulse" /></span>;
  const Icon = item.state === "completed" ? Check : item.state === "failed" ? X : item.state === "stopped" ? Square : CircleHelp;
  return <span className="activity-step-status" data-state={item.state} role="img" aria-label={label}><Icon size={12} aria-hidden="true" /></span>;
}

export function AgentActivity({ activity }: { activity: TurnActivity }) {
  const t = useTranslation();
  const reduced = useArcReducedMotion();
  const ambient = useAmbientActive();
  const catalog = useAppStore(state => state.modelsByProvider[activity.provider]);
  const modelLabel = (id: string) => modelDisplayName(activity.provider, catalog?.models.find(model => model.id === id)?.displayName ?? id, catalog?.models.map(model => model.displayName));
  const modelName = activity.model ? modelLabel(activity.model) : providerById(activity.provider).name;
  const active = isActivityActive(activity.status) && activity.endedAt === null;
  // A live turn shows its trail; once it settles the trail folds into the header line.
  // Chat behavior can keep finished turns open instead of folding them.
  const keepOpen = useAppStore((state) => !state.settings.foldFinishedTurns);
  const [view, setView] = useState({ active, expanded: active || keepOpen, all: false });
  if (view.active !== active) setView({ active, expanded: active || keepOpen, all: view.all });
  const [clock, setClock] = useState(() => ({ now: Date.now(), visible: false }));
  const node = useRef<HTMLDivElement>(null);
  const bodyId = useId();
  const ticking = active && activity.waitingSince === null;
  useEffect(() => {
    if (!active || !node.current) return;
    let onscreen = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => setClock({ now: Date.now(), visible: onscreen && !document.hidden });
    const schedule = () => {
      clearInterval(timer); timer = undefined;
      update();
      if (onscreen && !document.hidden && ticking) timer = setInterval(update, 1000);
    };
    const observer = new IntersectionObserver(([entry]) => { onscreen = entry.isIntersecting; schedule(); });
    observer.observe(node.current);
    document.addEventListener("visibilitychange", schedule);
    return () => { observer.disconnect(); clearInterval(timer); document.removeEventListener("visibilitychange", schedule); };
  }, [active, ticking]);
  const waiting = activity.status === "waiting";
  // An approval can wait for hours: its orbit only moves while someone can see it.
  const waitingMotion = waiting && !reduced && clock.visible && ambient;
  // A running turn can last minutes while the window sits in the background; its shimmer and pulses rest then.
  const live = ticking && clock.visible && !reduced && ambient;
  const label = waiting ? "Waiting for your response" : activity.status === "starting" ? "Starting" : activity.status === "running" ? "Working" : activity.status === "completed" ? "Worked for" : activity.status === "failed" ? "status.failed" : "status.stopped";
  const items = activity.items;
  const hidden = view.all ? 0 : Math.max(0, items.length - VISIBLE_STEPS);
  const hasDetails = items.length > 0;
  const subagentNumber = (item: ActivityItem) => items.filter(row => row.kind === "agent").indexOf(item) + 1;
  const chrome = <>
    <ActivityOrbit moving={live || waitingMotion} slow={waiting} />
    <span className="activity-model">{modelName}</span>
    <span className="activity-state">{t(label)}</span>
    <span className="activity-duration">{formatActivityDuration(activityElapsed(activity, clock.now))}</span>
    {waiting ? <span className="ui-micro text-text-muted">· {t("Paused")}</span> : null}
    {hasDetails ? <ChevronDown size={12} className={view.expanded ? "activity-chevron expanded" : "activity-chevron"} aria-hidden="true" /> : null}
  </>;
  return <div ref={node} className="agent-activity" data-status={activity.status} data-live={live || undefined} data-active={active || undefined} data-resting={(waiting && !waitingMotion) || undefined}>
    {hasDetails
      ? <button type="button" className="activity-line ui-control" aria-expanded={view.expanded} aria-controls={bodyId} onClick={() => setView(current => ({ ...current, expanded: !current.expanded }))}>{chrome}</button>
      : <div className="activity-line ui-control">{chrome}</div>}
    {hasDetails && view.expanded ? <div id={bodyId} className="activity-trail ui-caption">
      {hidden ? <button type="button" className="activity-trail-more" onClick={() => setView(current => ({ ...current, all: true }))}>{t("+{count} earlier steps", { count: hidden })}</button> : null}
      <ol className="activity-steps">
        {items.slice(hidden).map((item) => {
          if (item.kind === "agent") return <ChildRow key={item.id} item={item} modelLabel={modelLabel} name={item.label || t("Subagent {number}", { number: subagentNumber(item) })} now={clock.now} moving={live} />;
          const Icon = kindIcons[item.kind];
          const text = t(item.label || "Tool call");
          return <li key={item.id} className="activity-step" data-state={item.state} data-kind={item.kind}>
            <Icon size={13} className="activity-step-icon" aria-hidden="true" />
            <span className="activity-step-label">{item.kind === "command" ? <code>{text}</code> : text}</span>
            <StepStatus item={item} />
          </li>;
        })}
      </ol>
      {activity.truncated ? <p className="ui-micro text-text-muted">{t("Showing the first 128 activity items. Later updates to these items are retained.")}</p> : null}
    </div> : null}
  </div>;
}
