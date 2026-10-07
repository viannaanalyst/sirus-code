import { Fragment, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Bot, Box, Check, ChevronDown, ChevronRight, CircleHelp, Eye, FilePenLine, Globe, Hammer, Search, Square, Terminal, Wrench, X } from "@/components/icons/phosphor";
import type { ActivityItem, ActivityKind, ActivityStep, AgentProviderId, TurnActivity } from "@/client/types";
import { ModelIcon } from "@/components/ModelIcon";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { modelDisplayName, readableModelId } from "@/lib/model-registry";
import { useAppStore } from "@/store/app-store";
import { providerById } from "@/lib/providers";
import { activityElapsed, formatActivityDuration, isActivityActive } from "@/lib/agent-activity";
import { useTranslation } from "@/i18n/use-translation";
import { useArcReducedMotion } from "@/components/arc/lib/use-arc-motion";
import { useAmbientActive } from "@/lib/ambient-motion";
import { foldBoundary, groupSentence, stepCategory, stepSentence, timelineParts, type StepCategory } from "@/lib/turn-timeline";

const kindIcons: Record<ActivityKind, typeof Search> = { read: Search, edit: FilePenLine, command: Terminal, tool: Wrench, agent: Bot, skill: Box };
const stateLabels = { running: "status.running", completed: "status.completed", failed: "status.failed", stopped: "status.stopped", unknown: "Not reported" } as const;

/**
 * The turn's model as a small planet: its own logo, with a satellite that orbits while the
 * turn works (slowly, amber, while it waits for you) and rests green, red or grey when it ends.
 */
function ModelOrbit({ provider, model, status, moving }: { provider: AgentProviderId; model: string | null; status: TurnActivity["status"]; moving: boolean }) {
  return <span className="tl-model-orbit" data-status={status} data-moving={moving || undefined} aria-hidden="true">
    {model ? <ModelIcon modelId={model} provider={provider} size={14} /> : <ProviderIcon id={provider} size={14} className="bg-transparent" />}
    <i className="tl-satellite" />
  </span>;
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
const liveStepLabels: Record<ActivityKind, string> = { read: "Reading or searching…", edit: "Editing files…", command: "Running a command…", tool: "Using a tool…", agent: "Delegating a task…", skill: "Using a tool…" };

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

/** Category icons for T3-style rows; a mixed group shows a hammer. */
const categoryIcons: Record<StepCategory, typeof Search> = { skill: Box, edit: FilePenLine, command: Terminal, read: Eye, search: Search, web: Globe, tool: Wrench, agent: Bot };

function StepLine({ item, cwd, live = false }: { item: ActivityItem; cwd?: string; live?: boolean }) {
  const t = useTranslation();
  const outputId = useId();
  const category = stepCategory(item);
  const Icon = categoryIcons[category];
  const sentence = stepSentence(item, t, cwd);
  const output = item.output?.trim() ? item.output : "";
  // A failed command opens on its output; others open on click, like T3.
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = Boolean(output) && (open ?? item.state === "failed");
  const body = <>
    <span className="tl-icon"><Icon size={15} aria-hidden="true" /></span>
    <span className={`tl-label${live ? " tl-shine" : ""}`}>
      {sentence}{category === "skill" && item.detail ? <> <span className="tl-skill">/{item.detail}</span></> : null}
    </span>
    {item.state === "failed" ? <X size={12} className="tl-failed" aria-label={t("timeline.failed")} /> : item.state === "stopped" ? <Square size={10} className="tl-stopped" aria-label={t("timeline.stopped")} /> : null}
    {output ? <ChevronRight size={12} className={expanded ? "tl-detail-chevron tl-fold-open" : "tl-detail-chevron"} aria-hidden="true" /> : null}
  </>;
  if (!output) return <div className="tl-line" data-state={item.state} data-category={category}>{body}</div>;
  return <>
    <button type="button" className="tl-line tl-toggle" data-state={item.state} data-category={category} aria-expanded={expanded} aria-controls={outputId} onClick={() => setOpen(!expanded)}>{body}</button>
    {expanded ? <pre id={outputId} className="tl-output">{output}</pre> : null}
  </>;
}

/** Back-to-back steps: one sentence that opens into its rows; the step still running stays on its own live row. */
function WorkGroup({ items, cwd, live, modelLabel, now, moving }: { items: ActivityItem[]; cwd?: string; live: boolean; modelLabel: (id: string) => string; now: number; moving: boolean }) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const children = items.filter(item => item.kind === "agent");
  const steps = items.filter(item => item.kind !== "agent");
  // While the turn runs, its newest running step is the live row under the group.
  const current = live ? [...steps].reverse().find(item => item.state === "running") : undefined;
  const settled = current ? steps.filter(item => item !== current) : steps;
  // Failures stay visible even inside a closed group.
  const failed = open ? [] : settled.filter(item => item.state === "failed");
  const categories = new Set(settled.map(stepCategory));
  const GroupIcon = categories.size === 1 ? categoryIcons[[...categories][0]] : Hammer;
  return <div className="tl-group">
    {settled.length === 1 ? <StepLine item={settled[0]} cwd={cwd} /> : null}
    {settled.length > 1 ? <>
      <button type="button" className="tl-line tl-toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(value => !value)}>
        <span className="tl-icon"><GroupIcon size={15} aria-hidden="true" /></span>
        <span className="tl-label">{groupSentence(settled, t)}</span>
      </button>
      {open ? <div id={listId} className="tl-rows">{settled.map(item => <StepLine key={item.id} item={item} cwd={cwd} />)}</div> : null}
      {failed.map(item => <StepLine key={item.id} item={item} cwd={cwd} />)}
    </> : null}
    {current ? <StepLine item={current} cwd={cwd} live={moving} /> : null}
    {children.length ? <ol className="activity-steps tl-children">
      {children.map((item, index) => <ChildRow key={item.id} item={item} modelLabel={modelLabel} name={item.label || t("Subagent {number}", { number: index + 1 })} now={now} moving={moving} />)}
    </ol> : null}
  </div>;
}

/**
 * A turn as T3 Code shows it: reply text and work in the order they happened; back-to-back
 * steps fold into one sentence; a finished turn folds everything before its final answer behind
 * "Worked for …". Without `renderText` (side chat) only the work shows, under the header.
 */
export function AgentActivity({ activity, content = "", steers = [], renderText, renderSteer, cwd }: {
  activity: TurnActivity; content?: string; steers?: readonly { offset: number; text: string }[];
  renderText?: (start: number, end: number) => ReactNode; renderSteer?: (text: string) => ReactNode; cwd?: string;
}) {
  const t = useTranslation();
  const reduced = useArcReducedMotion();
  const ambient = useAmbientActive();
  const catalog = useAppStore(state => state.modelsByProvider[activity.provider]);
  // A native id the catalog does not list (a dated snapshot) still reads like the picker: "Haiku 4.5".
  const modelLabel = (id: string) => { const known = catalog?.models.find(model => model.id === id)?.displayName; return known ? modelDisplayName(activity.provider, known, catalog?.models.map(model => model.displayName)).replace(/^Claude\s+/i, "") : readableModelId(id); };
  const modelName = activity.model ? modelLabel(activity.model) : providerById(activity.provider).name;
  const active = isActivityActive(activity.status) && activity.endedAt === null;
  // Chat behavior can keep finished turns open instead of folding them.
  const keepOpen = useAppStore((state) => !state.settings.foldFinishedTurns);
  const [view, setView] = useState({ active, expanded: active || keepOpen });
  if (view.active !== active) setView({ active, expanded: active || keepOpen });
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
  // A running turn can last minutes while the window sits in the background; its shimmer rests then.
  const live = ticking && clock.visible && !reduced && ambient;
  const duration = formatActivityDuration(activityElapsed(activity, clock.now));
  const label = waiting ? t("timeline.waiting") : activity.status === "starting" ? t("timeline.starting")
    : active ? t("timeline.workingFor", { duration })
    : activity.status === "stopped" ? t("timeline.stoppedAfter", { duration })
    : activity.status === "failed" ? t("timeline.failedAfter", { duration })
    : t("timeline.workedFor", { duration });
  const parts = useMemo(() => timelineParts(renderText ? content : "", activity.items, renderText ? steers : []), [activity.items, content, steers, renderText]);
  const boundary = foldBoundary(parts);
  const folded = !active && !view.expanded;
  const foldable = !active && boundary > 0;
  const lastWork = parts.reduce((last, part, index) => part.kind === "work" ? index : last, -1);
  const chrome = <>
    <ModelOrbit provider={activity.provider} model={activity.model} status={activity.status} moving={live || waitingMotion} />
    <span className="activity-model">{modelName}</span>
    <span className="activity-state">{label}</span>
    {waiting ? <span className="ui-micro text-text-muted">· {t("Paused")}</span> : null}
    {foldable ? <ChevronRight size={14} className={view.expanded ? "activity-chevron tl-fold-open" : "activity-chevron"} aria-hidden="true" /> : null}
  </>;
  return <div ref={node} className="agent-activity tl-turn" data-status={activity.status} data-live={live || undefined} data-active={active || undefined} data-resting={(waiting && !waitingMotion) || undefined}>
    {foldable
      ? <button type="button" className="activity-line tl-header ui-control" aria-expanded={view.expanded} aria-controls={bodyId} onClick={() => setView(current => ({ ...current, expanded: !current.expanded }))}>{chrome}</button>
      : <div className="activity-line tl-header ui-control">{chrome}</div>}
    <div id={bodyId} className="tl-body">
      {parts.map((part, index) => {
        const hidden = folded && index < boundary;
        if (part.kind === "text") return hidden ? null : <Fragment key={`t${part.start}`}>{renderText?.(part.start, part.end)}</Fragment>;
        if (part.kind === "steer") return hidden ? null : <Fragment key={`s${index}`}>{renderSteer?.(part.text)}</Fragment>;
        // A folded turn still shows the steps that failed.
        const items = hidden ? part.items.filter(item => item.state === "failed") : part.items;
        return items.length ? <WorkGroup key={`w${index}`} items={items} cwd={cwd} live={active && index === lastWork} modelLabel={modelLabel} now={clock.now} moving={live} /> : null;
      })}
      {activity.truncated && !folded ? <p className="ui-micro text-text-muted">{t("Showing the first 128 activity items. Later updates to these items are retained.")}</p> : null}
    </div>
  </div>;
}
