import type { AgentProviderId, MemoryPressure, ResourceProcess, ResourceProcessKind, ResourceSnapshot, Session, SessionStatus } from "@/client/types";

/**
 * What the running agents cost the Mac (ADR-144): pure helpers for the sidebar's resource
 * indicator and panel. CPU is a share of one core, as in Activity Monitor (100% = one core).
 */
export type ResourceLevel = "normal" | "elevated" | "high";

export interface MachineContext {
  cores: number;
  memoryTotal: number | null;
  memoryPressure: MemoryPressure | null;
}

/** The whole set of agents against the Mac: amber from 40% of every core or a quarter of memory, red from 75% or half. */
export const TOTAL_THRESHOLDS = { cpuShare: [0.4, 0.75], memoryShare: [0.25, 0.5] } as const;
/** One session or process: amber from nearly a full core or a tenth of memory, red from two cores or a quarter. */
export const ROW_THRESHOLDS = { cpuPercent: [90, 200], memoryShare: [0.1, 0.25] } as const;

const rank: Record<ResourceLevel, number> = { normal: 0, elevated: 1, high: 2 };
const worst = (...levels: ResourceLevel[]): ResourceLevel => levels.reduce((a, b) => rank[b] > rank[a] ? b : a, "normal");
const step = (value: number, [elevated, high]: readonly [number, number]): ResourceLevel =>
  value >= high ? "high" : value >= elevated ? "elevated" : "normal";

/** The indicator's level: the agents' totals, and the Mac's memory pressure whoever causes it. */
export function totalLevel(cpuPercent: number, memoryBytes: number, machine: MachineContext): ResourceLevel {
  const cpuShare = cpuPercent / (Math.max(1, machine.cores) * 100);
  const memoryShare = machine.memoryTotal ? memoryBytes / machine.memoryTotal : 0;
  const pressure: ResourceLevel = machine.memoryPressure === "critical" ? "high" : machine.memoryPressure === "warning" ? "elevated" : "normal";
  return worst(step(cpuShare, TOTAL_THRESHOLDS.cpuShare), step(memoryShare, TOTAL_THRESHOLDS.memoryShare), pressure);
}

/** A session's or process's level, to tint its numbers. */
export function rowLevel(cpuPercent: number, memoryBytes: number, machine: MachineContext): ResourceLevel {
  const memoryShare = machine.memoryTotal ? memoryBytes / machine.memoryTotal : 0;
  return worst(step(cpuPercent, ROW_THRESHOLDS.cpuPercent), step(memoryShare, ROW_THRESHOLDS.memoryShare));
}

export const snapshotLevel = (snapshot: ResourceSnapshot | null): ResourceLevel =>
  snapshot ? totalLevel(snapshot.cpuPercent, snapshot.memoryBytes, snapshot) : "normal";

/** A turn whose CLI is alive: starting, working or waiting for an answer. */
export const isRunningStatus = (status: SessionStatus) => status === "starting" || status === "running" || status === "waiting";

/** Ids of running sessions, sorted, as one key: the indicator reads again when it changes. */
export function runningKey(sessions: Pick<Session, "id" | "status">[]): string {
  return sessions.filter(session => isRunningStatus(session.status)).map(session => session.id).sort().join(",");
}

export interface ResourceRow {
  sessionId: string;
  title: string;
  provider: AgentProviderId | null;
  cpuPercent: number;
  memoryBytes: number;
  processCount: number;
  processes: ResourceProcess[];
}

/** Native readings joined with the sessions' titles and providers, busiest first. */
export function resourceRows(snapshot: ResourceSnapshot | null, sessions: Pick<Session, "id" | "title" | "agent">[]): ResourceRow[] {
  if (!snapshot) return [];
  const byId = new Map(sessions.map(session => [session.id, session]));
  return snapshot.sessions
    .map(entry => {
      const session = byId.get(entry.sessionId);
      return { sessionId: entry.sessionId, title: session?.title ?? "", provider: session?.agent ?? null, cpuPercent: entry.cpuPercent, memoryBytes: entry.memoryBytes, processCount: entry.processCount, processes: entry.processes };
    })
    .sort((a, b) => b.cpuPercent - a.cpuPercent || b.memoryBytes - a.memoryBytes || a.sessionId.localeCompare(b.sessionId));
}

/** Readings hide processes being stopped, so a row leaves at once instead of after the next sample. */
export function withoutStopping(rows: ResourceRow[], stopping: ReadonlySet<number>): ResourceRow[] {
  if (!stopping.size) return rows;
  return rows.map(row => {
    if (!row.processes.some(process => stopping.has(process.pid))) return row;
    const processes = row.processes.filter(process => !stopping.has(process.pid));
    return { ...row, processes, processCount: Math.max(processes.length, row.processCount - (row.processes.length - processes.length)) };
  });
}

/** Only tools can be stopped one by one; the agent stops with the conversation. */
export const canStopProcess = (process: Pick<ResourceProcess, "kind" | "pid">) => process.kind !== "agent" && process.pid > 1;

export function formatCpu(percent: number): string {
  if (!Number.isFinite(percent) || percent <= 0) return "0%";
  if (percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

export function formatMemory(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return "<1 MB";
  if (mb < 1024) return `${Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}

/** The i18n key of a process kind's short label. */
export const kindLabelKey = (kind: ResourceProcessKind) => `resources.kind.${kind}`;

/** Ease-out position of a number moving from `from` to `to`, `progress` in 0…1. */
export function tweenValue(from: number, to: number, progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return from + (to - from) * (1 - (1 - t) ** 3);
}
