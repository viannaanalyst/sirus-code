import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { client } from "@/client";
import type { ResourceProcess, ResourceSnapshot } from "@/client/types";
import { ChevronRight, Gauge } from "@/components/icons/phosphor";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { canStopProcess, formatCpu, formatMemory, kindLabelKey, resourceRows, rowLevel, runningKey, snapshotLevel, tweenValue, withoutStopping, type ResourceLevel, type ResourceRow } from "@/lib/agent-resources";
import { cascadeIndex, useCascade } from "@/lib/cascade";
import { cn } from "@/lib/cn";
import { formatUnknownError } from "@/lib/format-error";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";
import "@/styles/agent-resources.css";

/** While the panel is open it reads every 2 s; closed, only when the running set changes, on focus and on hover. */
const OPEN_INTERVAL_MS = 2000;
const SETTLE_MS = 1500;
const EVENT_GAP_MS = 5000;
const TWEEN_MS = 400;

/**
 * What the running agents cost the Mac, at the sidebar's foot (ADR-144). It shows only while a
 * conversation runs, turns amber or red when the agents use a lot of CPU or memory (or the Mac is
 * under memory pressure), and opens a panel to stop a conversation or one of its processes.
 */
function AgentResourcesView({ placement }: { placement: "rail" | "foot" }) {
  const running = useAppStore(state => runningKey(selectSessionsMeta(state)));
  // The rail keeps its place while idle, so the quota rings above it do not move when a turn starts.
  if (!running) return placement === "rail" ? <span className="agent-resources-slot" aria-hidden="true" /> : null;
  return <Indicator placement={placement} running={running} />;
}

export const AgentResources = memo(AgentResourcesView);

function Indicator({ placement, running }: { placement: "rail" | "foot"; running: string }) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<ResourceSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reading = useRef(false);
  const lastRead = useRef(0);
  const read = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    try {
      setSnapshot(await client.agentResources());
      setError(null);
    } catch (cause) {
      setError(formatUnknownError(cause));
    } finally {
      reading.current = false;
      lastRead.current = Date.now();
    }
  }, []);
  const readIfStale = useCallback(() => {
    if (Date.now() - lastRead.current >= EVENT_GAP_MS && document.visibilityState !== "hidden") void read();
  }, [read]);
  // A turn started or ended: read once the new process has settled.
  useEffect(() => {
    const timer = setTimeout(() => void read(), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [running, read]);
  useEffect(() => {
    window.addEventListener("focus", readIfStale);
    return () => window.removeEventListener("focus", readIfStale);
  }, [readIfStale]);
  // Open: every 2 s while the window is visible, never in the background.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (document.visibilityState !== "hidden") await read();
      if (!cancelled) timer = setTimeout(() => void tick(), OPEN_INTERVAL_MS);
    };
    void tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, read]);

  const level = snapshotLevel(snapshot);
  const label = snapshot
    ? t("resources.indicator", { cpu: formatCpu(snapshot.cpuPercent), memory: formatMemory(snapshot.memoryBytes) })
    : t("resources.indicatorIdle");
  const rail = placement === "rail";
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" className={cn("sidebar-rail-button agent-resources-trigger", rail ? "agent-resources-rail" : "conversation-sidebar-foot-button")}
        data-level={level} aria-label={label} title={label} onPointerEnter={readIfStale}>
        <Gauge size={rail ? 20 : 17} weight={level === "normal" ? undefined : "fill"} />
      </button>
    </PopoverTrigger>
    <PopoverContent side={rail ? "right" : "top"} align={rail ? "end" : "start"} sideOffset={10}
      className="agent-resources-popover scroll-thin max-h-[min(520px,80vh)] w-[340px] overflow-y-auto p-0" aria-label={t("resources.title")}>
      <ResourcePanel snapshot={snapshot} error={error} refresh={read} open={open} />
    </PopoverContent>
  </Popover>;
}

function ResourcePanel({ snapshot, error, refresh, open }: { snapshot: ResourceSnapshot | null; error: string | null; refresh: () => Promise<void>; open: boolean }) {
  const t = useTranslation();
  const sessions = useAppStore(selectSessionsMeta);
  const cascade = useCascade(open);
  const [stopping, setStopping] = useState<ReadonlySet<number>>(() => new Set());
  const [stoppingSessions, setStoppingSessions] = useState<ReadonlySet<string>>(() => new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const rows = useMemo(() => withoutStopping(resourceRows(snapshot, sessions), stopping), [snapshot, sessions, stopping]);
  const level = snapshotLevel(snapshot);

  const toggle = (id: string) => setExpanded(current => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const stopSession = async (row: ResourceRow) => {
    setStoppingSessions(current => new Set(current).add(row.sessionId));
    try {
      await useAppStore.getState().stopAgent(row.sessionId);
    } catch (cause) {
      setRowErrors(current => ({ ...current, [row.sessionId]: formatUnknownError(cause) }));
    } finally {
      setStoppingSessions(current => { const next = new Set(current); next.delete(row.sessionId); return next; });
      void refresh();
    }
  };
  const stopProcess = async (row: ResourceRow, process: ResourceProcess) => {
    setStopping(current => new Set(current).add(process.pid));
    setRowErrors(current => { const next = { ...current }; delete next[row.sessionId]; return next; });
    try {
      await client.agentResourceAction({ type: "stopProcess", sessionId: row.sessionId, pid: process.pid, started: process.started });
    } catch (cause) {
      setStopping(current => { const next = new Set(current); next.delete(process.pid); return next; });
      setRowErrors(current => ({ ...current, [row.sessionId]: formatUnknownError(cause) }));
    }
    void refresh();
  };

  return <div className="agent-resources-panel" data-cascade={cascade ? "" : undefined}>
    <header className="agent-resources-head">
      <span className="ui-section-title text-text-primary">{t("resources.title")}</span>
      {snapshot ? <span className="agent-resources-totals ui-caption" data-level={level}>
        <span>{t("resources.cpu")} <SmoothNumber value={snapshot.cpuPercent} format={formatCpu} /></span>
        <span aria-hidden="true">·</span>
        <span>{t("resources.memory")} <SmoothNumber value={snapshot.memoryBytes} format={formatMemory} /></span>
      </span> : null}
      {snapshot?.memoryPressure ? <span className="agent-resources-pressure ui-caption" data-pressure={snapshot.memoryPressure}>{t(`resources.pressure.${snapshot.memoryPressure}`)}</span> : null}
    </header>
    {error ? <p className="agent-resources-error ui-caption" role="alert">{error}</p> : null}
    {!snapshot && !error ? <p className="agent-resources-note ui-caption">{t("resources.loading")}</p> : null}
    {snapshot && !rows.length ? <p className="agent-resources-note ui-caption">{t("resources.empty")}</p> : null}
    {rows.length ? <ul className="agent-resources-list">
      {rows.map((row, index) => {
        const open = expanded.has(row.sessionId);
        const title = row.title.trim() || t("resources.untitled");
        const busy = stoppingSessions.has(row.sessionId);
        return <li key={row.sessionId} className="agent-resources-session" data-cascade-item="" style={cascadeIndex(index)}>
          <div className="agent-resources-row">
            <button type="button" className="agent-resources-toggle" aria-expanded={open} aria-label={`${title} · ${t(open ? "resources.collapse" : "resources.expand")}`} onClick={() => toggle(row.sessionId)}>
              <ChevronRight size={12} className="agent-resources-chevron" aria-hidden="true" />
              {row.provider ? <ProviderIcon id={row.provider} size={16} /> : null}
              <span className="ui-control min-w-0 truncate">{title}</span>
            </button>
            <Figures cpu={row.cpuPercent} memory={row.memoryBytes} level={snapshot ? rowLevel(row.cpuPercent, row.memoryBytes, snapshot) : "normal"} />
            <button type="button" className="agent-resources-stop ui-caption" disabled={busy} aria-label={t("resources.stopSession", { title })} onClick={() => void stopSession(row)}>
              {busy ? t("resources.stopping") : t("resources.stop")}
            </button>
          </div>
          {rowErrors[row.sessionId] ? <p className="agent-resources-error ui-caption" role="alert">{rowErrors[row.sessionId]}</p> : null}
          <div className="agent-resources-details" data-open={open || undefined} inert={!open}>
            <div>
              <ul className="agent-resources-processes">
                {row.processes.map(process => <li key={process.pid} className="agent-resources-row agent-resources-process">
                  <span className="agent-resources-name">
                    <span className="ui-caption min-w-0 truncate text-text-primary">{process.name}</span>
                    <span className="ui-caption shrink-0 text-text-muted">{t(kindLabelKey(process.kind))}</span>
                  </span>
                  <Figures cpu={process.cpuPercent} memory={process.memoryBytes} level={snapshot ? rowLevel(process.cpuPercent, process.memoryBytes, snapshot) : "normal"} />
                  {canStopProcess(process)
                    ? <button type="button" className="agent-resources-stop ui-caption" aria-label={t("resources.stopProcess", { name: process.name })} onClick={() => void stopProcess(row, process)}>{t("resources.stop")}</button>
                    : <span aria-hidden="true" />}
                </li>)}
              </ul>
              {row.processCount > row.processes.length
                ? <p className="agent-resources-note ui-caption">{t("resources.more", { count: row.processCount - row.processes.length })}</p> : null}
            </div>
          </div>
        </li>;
      })}
    </ul> : null}
    <p className="agent-resources-footnote ui-caption">{t("resources.footnote")}</p>
  </div>;
}

function Figures({ cpu, memory, level }: { cpu: number; memory: number; level: ResourceLevel }) {
  return <>
    <span className="agent-resources-figure ui-caption" data-level={level}><SmoothNumber value={cpu} format={formatCpu} /></span>
    <span className="agent-resources-figure ui-caption" data-level={level}><SmoothNumber value={memory} format={formatMemory} /></span>
  </>;
}

/** A reading that glides to its next value instead of jumping (reduced motion: it jumps). */
function SmoothNumber({ value, format }: { value: number; format: (value: number) => string }) {
  const reduced = useMotionPreferences();
  const [shown, setShown] = useState(value);
  const current = useRef(value);
  useEffect(() => {
    const from = current.current;
    if (reduced || from === value) {
      current.current = value;
      const frame = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(frame);
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = (now - start) / TWEEN_MS;
      current.current = tweenValue(from, value, progress);
      setShown(current.current);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);
  return <span className="tabular-nums">{format(shown)}</span>;
}
