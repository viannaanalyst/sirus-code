import { REMOTE_TOKEN_KEY } from "@/client/remote-pairing";
import type { RemoteConnection } from "@/client/remote-transport";
import type { AppSettings, Project, Session } from "@/client/types";
import { toggleSidebarId } from "@/lib/sidebar-layout";
import { isAuxiliarySession } from "@/lib/pull-ask";

/**
 * One phone app, several computers (ADR-132). The page the app was installed from is the
 * "home" computer, paired with its own token (`REMOTE_TOKEN_KEY`, as before). Other Sirus
 * computers on the same tailnet (the Mac app's server, a headless `sirus-host`) are added by
 * address and six-digit code; their tokens live in this phone's storage with the list.
 */

export type EnvironmentKind = "mac" | "server";

export interface Environment {
  /** `home` for the page's own origin; otherwise the other computer's host id or address. */
  id: string;
  /** The name the person gave it; empty shows the default ("Mac" or the server's name). */
  label: string;
  kind: EnvironmentKind;
  /** `https://name.tailnet.ts.net` (an origin, no path). */
  baseUrl: string;
  /** The device token; the home computer's stays under `REMOTE_TOKEN_KEY`. */
  token: string;
  hostName: string;
}

/** What a computer says about itself on `/api/health` and when pairing. */
export interface HostIdentity { id?: string; hostName?: string; kind?: string }

/** The last-known conversations of a computer that is not the active one. */
export interface EnvironmentSummary {
  sessions: Session[];
  projects: Project[];
  pinnedSessionIds: string[];
  updatedAt: number;
}

export const HOME_ENVIRONMENT = "home";
export const ENVIRONMENTS_KEY = "sirus.environments";
export const ACTIVE_ENVIRONMENT_KEY = "sirus.environments.active";
export const SUMMARIES_KEY = "sirus.environments.summaries";
/** Conversations kept per computer for the offline Home: the most recent ones. */
export const SUMMARY_LIMIT = 150;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * A typed address as an origin: "sirus-vps.tail6e87c3.ts.net" becomes
 * "https://sirus-vps.tail6e87c3.ts.net". Paths are dropped; anything else is null.
 */
export function normalizeBaseUrl(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || !url.hostname.includes(".")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function environmentKind(value: unknown): EnvironmentKind {
  return value === "server" ? "server" : "mac";
}

function validEnvironment(value: unknown): value is Environment {
  const item = value as Partial<Environment> | null;
  return !!item && typeof item.id === "string" && !!item.id && typeof item.baseUrl === "string" && typeof item.token === "string";
}

/**
 * The computers this phone knows, the home one first. `origin` is the page's own origin; the
 * home token is read from its old key so existing pairings keep working.
 */
export function readEnvironments(storage: Pick<Storage, "getItem">, origin: string): Environment[] {
  let stored: unknown[] = [];
  try {
    const value = JSON.parse(storage.getItem(ENVIRONMENTS_KEY) ?? "[]") as unknown;
    if (Array.isArray(value)) stored = value;
  } catch { /* unreadable: only the home computer */ }
  const items = stored.filter(validEnvironment).map((item) => ({
    id: item.id,
    label: typeof item.label === "string" ? item.label : "",
    kind: environmentKind(item.kind),
    baseUrl: item.baseUrl,
    token: item.token,
    hostName: typeof item.hostName === "string" ? item.hostName : "",
  }));
  const savedHome = items.find((item) => item.id === HOME_ENVIRONMENT);
  const home: Environment = {
    id: HOME_ENVIRONMENT,
    label: savedHome?.label ?? "",
    kind: savedHome?.kind ?? "mac",
    baseUrl: origin,
    token: storage.getItem(REMOTE_TOKEN_KEY) ?? "",
    hostName: savedHome?.hostName ?? "",
  };
  const others = items.filter((item) => item.id !== HOME_ENVIRONMENT && item.baseUrl !== origin);
  return [home, ...others.filter((item, index) => others.findIndex((other) => other.baseUrl === item.baseUrl) === index)];
}

/** Saves the list; the home token stays under its own key and never in the list. */
export function writeEnvironments(storage: Store, environments: readonly Environment[]) {
  storage.setItem(ENVIRONMENTS_KEY, JSON.stringify(environments.map((item) => item.id === HOME_ENVIRONMENT ? { ...item, token: "" } : item)));
}

/**
 * Adds a newly paired computer, or replaces the one at the same address or with the same host
 * id (pairing again gives a new token). Its name survives a re-pairing.
 */
export function upsertEnvironment(environments: readonly Environment[], next: Environment): Environment[] {
  const at = environments.findIndex((item) => item.id !== HOME_ENVIRONMENT && (item.baseUrl === next.baseUrl || item.id === next.id));
  if (at < 0) return [...environments, next];
  const label = next.label || environments[at].label;
  return environments.map((item, index) => index === at ? { ...next, label } : item);
}

export function renameEnvironment(environments: readonly Environment[], id: string, label: string): Environment[] {
  return environments.map((item) => item.id === id ? { ...item, label: label.trim().slice(0, 40) } : item);
}

/** Forgets a computer on this phone (its token goes with it); the home one stays. */
export function removeEnvironment(environments: readonly Environment[], id: string): Environment[] {
  return id === HOME_ENVIRONMENT ? [...environments] : environments.filter((item) => item.id !== id);
}

/** The entry for a computer just paired, from what it said about itself. */
export function pairedEnvironment(baseUrl: string, token: string, host: HostIdentity | undefined): Environment {
  return {
    id: host?.id ? `host:${host.id}` : `url:${baseUrl}`,
    label: "",
    kind: environmentKind(host?.kind),
    baseUrl,
    token,
    hostName: host?.hostName?.trim() ?? "",
  };
}

/** What the phone calls a computer: the person's name for it, else "Mac", else the server's name. */
export function environmentLabel(environment: Pick<Environment, "label" | "kind" | "hostName">, serverNoun = "Server"): string {
  if (environment.label.trim()) return environment.label.trim();
  if (environment.kind === "mac") return "Mac";
  return environment.hostName.trim() || serverNoun;
}

/** The active computer, if it is still known and paired; else the home one. */
export function chooseActive(environments: readonly Environment[], stored: string | null): string {
  const chosen = environments.find((item) => item.id === stored && item.token);
  return chosen?.id ?? HOME_ENVIRONMENT;
}

/** A computer's data, trimmed for the Home of another computer and the offline cache. */
export function summarize(data: { sessions: readonly Session[]; projects: readonly Project[]; pinnedSessionIds?: readonly string[] }, now = Date.now()): EnvironmentSummary {
  const sessions = data.sessions
    .filter((session) => !isAuxiliarySession(session))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
    .slice(0, SUMMARY_LIMIT)
    .map((session) => ({ ...session, messages: [] }));
  const ids = new Set(sessions.map((session) => session.id));
  return {
    sessions,
    projects: [...data.projects],
    pinnedSessionIds: (data.pinnedSessionIds ?? []).filter((id) => ids.has(id)),
    updatedAt: now,
  };
}

/** A session update from another computer, applied to its summary (new ones go first). */
export function applySessionUpdate(summary: EnvironmentSummary, session: Session, now = Date.now()): EnvironmentSummary {
  if (isAuxiliarySession(session)) return summary;
  const trimmed = { ...session, messages: [] };
  const known = summary.sessions.some((item) => item.id === session.id);
  return {
    ...summary,
    sessions: known ? summary.sessions.map((item) => item.id === session.id ? trimmed : item) : [trimmed, ...summary.sessions].slice(0, SUMMARY_LIMIT),
    updatedAt: now,
  };
}

export interface MergedHome {
  sessions: Session[];
  projects: Project[];
  pinnedSessionIds: string[];
  /** Which computer each conversation and project belongs to. */
  environmentOf: Map<string, string>;
}

/**
 * The Home of every computer at once: the active computer's live data plus the others' last
 * known summaries. A conversation or project known on the active computer is never shown
 * twice; the sections and order come from the usual Home helpers.
 */
export function mergeEnvironments(active: { id: string } & Omit<EnvironmentSummary, "updatedAt">, others: readonly ({ id: string } & Omit<EnvironmentSummary, "updatedAt">)[]): MergedHome {
  const environmentOf = new Map<string, string>();
  const sessions: Session[] = [];
  const projects: Project[] = [];
  const pinned: string[] = [];
  for (const source of [active, ...others]) {
    for (const project of source.projects) {
      if (environmentOf.has(project.id)) continue;
      environmentOf.set(project.id, source.id);
      projects.push(project);
    }
    for (const session of source.sessions) {
      if (environmentOf.has(session.id)) continue;
      environmentOf.set(session.id, source.id);
      sessions.push(session);
    }
    pinned.push(...source.pinnedSessionIds);
  }
  return { sessions, projects, pinnedSessionIds: pinned, environmentOf };
}

export function readSummaries(storage: Pick<Storage, "getItem">): Record<string, EnvironmentSummary> {
  try {
    const value = JSON.parse(storage.getItem(SUMMARIES_KEY) ?? "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result: Record<string, EnvironmentSummary> = {};
    for (const [id, item] of Object.entries(value as Record<string, Partial<EnvironmentSummary>>)) {
      if (!Array.isArray(item?.sessions) || !Array.isArray(item.projects)) continue;
      result[id] = {
        sessions: item.sessions,
        projects: item.projects,
        pinnedSessionIds: Array.isArray(item.pinnedSessionIds) ? item.pinnedSessionIds : [],
        updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : 0,
      };
    }
    return result;
  } catch {
    return {};
  }
}

/** Keeps the summaries for the offline Home; a full storage only loses the cache. */
export function writeSummaries(storage: Store, summaries: Record<string, EnvironmentSummary>) {
  try { storage.setItem(SUMMARIES_KEY, JSON.stringify(summaries)); } catch { /* quota: the cache is optional */ }
}

/**
 * Where a conversation row's swipe and menu actions run (ADR-132): on the main store when the
 * row is the active computer's, through that computer's own client when it answers, and nowhere
 * when it is off or still connecting (the menu then only copies the id).
 */
export type RowActionRoute =
  | { kind: "store" }
  | { kind: "remote"; environmentId: string }
  | { kind: "unreachable"; environmentId: string; connecting: boolean };

export function rowActionRoute(environmentId: string | undefined, storeId: string, connection: RemoteConnection | undefined): RowActionRoute {
  if (!environmentId || environmentId === storeId) return { kind: "store" };
  if (connection === "open") return { kind: "remote", environmentId };
  return { kind: "unreachable", environmentId, connecting: connection !== "lost" && connection !== "unauthorized" };
}

/** Menu items that still work when the row's computer cannot be reached: they never leave the phone. */
const LOCAL_ROW_ITEMS = new Set(["copy-id", "arrange"]);

/** A row's menu for an unreachable computer: every item that needs the computer is disabled. */
export function unreachableRowMenu<T extends { id: string; disabled?: boolean }>(items: readonly T[]): T[] {
  return items.map((item) => LOCAL_ROW_ITEMS.has(item.id) ? item : { ...item, disabled: true });
}

/** The settings-backed row actions, applied to the settings of the computer the row lives on. */
export type RowSettingsAction = "pin" | "unpin";

export function applyRowSettingsAction(settings: AppSettings, action: RowSettingsAction, sessionId: string): AppSettings {
  switch (action) {
    case "pin": return settings.pinnedSessionIds.includes(sessionId) ? settings : { ...settings, pinnedSessionIds: toggleSidebarId(settings.pinnedSessionIds, sessionId) };
    case "unpin": return { ...settings, pinnedSessionIds: settings.pinnedSessionIds.filter((id) => id !== sessionId) };
  }
}

/** A summary after its computer's settings changed (pin list). */
export function summaryWithSettings(summary: EnvironmentSummary, settings: Pick<AppSettings, "pinnedSessionIds">, now = Date.now()): EnvironmentSummary {
  return { ...summary, pinnedSessionIds: [...(settings.pinnedSessionIds ?? [])], updatedAt: now };
}

/** A summary without a deleted conversation (and its side chats, which never are in it). */
export function summaryWithoutSession(summary: EnvironmentSummary, sessionId: string, now = Date.now()): EnvironmentSummary {
  return {
    ...summary,
    sessions: summary.sessions.filter((session) => session.id !== sessionId),
    pinnedSessionIds: summary.pinnedSessionIds.filter((id) => id !== sessionId),
    updatedAt: now,
  };
}

/** A row action as any computer takes it (ADR-132): settings lists, snooze, rename, delete. */
export type RowAction =
  | { type: RowSettingsAction }
  | { type: "snooze"; until: string | null }
  | { type: "rename"; title: string }
  | { type: "delete"; removeWorktree: boolean };

/**
 * A row action waiting on the phone for its computer to come back, like the message outbox
 * (`phone-outbox.ts`): applied in order once that computer answers, then dropped.
 */
export interface PendingRowAction {
  id: string;
  environmentId: string;
  sessionId: string;
  action: RowAction;
  createdAt: number;
}

export const PENDING_ACTIONS_KEY = "sirus.environments.pending";
/** Actions kept waiting at most; the oldest go first when there are more. */
export const PENDING_LIMIT = 100;

const ROW_ACTION_TYPES = new Set(["pin", "unpin", "snooze", "rename", "delete"]);

function validRowAction(value: unknown): value is RowAction {
  const action = value as { type?: unknown; until?: unknown; title?: unknown; enabled?: unknown; removeWorktree?: unknown } | null;
  if (!action || typeof action.type !== "string" || !ROW_ACTION_TYPES.has(action.type)) return false;
  if (action.type === "snooze") return action.until === null || typeof action.until === "string";
  if (action.type === "rename") return typeof action.title === "string" && !!action.title.trim();
  if (action.type === "delete") return typeof action.removeWorktree === "boolean";
  return true;
}

export function readPendingActions(storage: Pick<Storage, "getItem">): PendingRowAction[] {
  try {
    const value = JSON.parse(storage.getItem(PENDING_ACTIONS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is PendingRowAction => !!item && typeof item.id === "string" && typeof item.environmentId === "string"
      && typeof item.sessionId === "string" && typeof item.createdAt === "number" && validRowAction(item.action));
  } catch {
    return [];
  }
}

export function writePendingActions(storage: Store, actions: readonly PendingRowAction[]) {
  try { storage.setItem(PENDING_ACTIONS_KEY, JSON.stringify(actions)); } catch { /* quota: they stay in memory */ }
}

/** Which earlier waiting action a new one replaces: the same kind of change to the same conversation. */
function slot(action: RowAction): string {
  switch (action.type) {
    case "pin": case "unpin": return "pin";
    default: return action.type;
  }
}

/**
 * Queues an action for a computer that cannot be reached. A later change of the same kind
 * replaces the earlier one (pin then unpin leaves only the unpin); a delete replaces
 * everything waiting for that conversation.
 */
export function queueRowAction(actions: readonly PendingRowAction[], next: Omit<PendingRowAction, "id" | "createdAt">, now = Date.now()): PendingRowAction[] {
  const same = (item: PendingRowAction) => item.environmentId === next.environmentId && item.sessionId === next.sessionId;
  const kept = actions.filter((item) => !same(item) || (next.action.type !== "delete" && slot(item.action) !== slot(next.action)));
  const item: PendingRowAction = { ...next, id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, createdAt: now };
  return [...kept, item].slice(-PENDING_LIMIT);
}

/** The conversations with something waiting, by computer: rows show a quiet pending mark. */
export function pendingSessions(actions: readonly PendingRowAction[], environmentId: string): Set<string> {
  return new Set(actions.filter((item) => item.environmentId === environmentId).map((item) => item.sessionId));
}

/**
 * How a waiting action shows in a summary until its computer takes it: pinned,
 * snoozed, renamed or gone, so the lists already look as the person left them.
 */
export function summaryWithPending(summary: EnvironmentSummary, actions: readonly PendingRowAction[]): EnvironmentSummary {
  let next = summary;
  for (const { action, sessionId } of actions) {
    switch (action.type) {
      case "pin": case "unpin": {
        const settings = applyRowSettingsAction({ pinnedSessionIds: next.pinnedSessionIds } as AppSettings, action.type, sessionId);
        next = { ...next, pinnedSessionIds: settings.pinnedSessionIds };
        break;
      }
      case "snooze": next = { ...next, sessions: next.sessions.map((session) => session.id === sessionId ? { ...session, snoozedUntil: action.until } : session) }; break;
      case "rename": next = { ...next, sessions: next.sessions.map((session) => session.id === sessionId ? { ...session, title: action.title.trim() } : session) }; break;
      case "delete": next = summaryWithoutSession(next, sessionId, next.updatedAt); break;
    }
  }
  return next;
}

/**
 * Sends one computer's waiting actions in order; one that fails stays with the rest behind it.
 * Returns what is left in the whole queue.
 */
export async function flushPendingActions(actions: readonly PendingRowAction[], environmentId: string, send: (item: PendingRowAction) => Promise<boolean>): Promise<PendingRowAction[]> {
  const done = new Set<string>();
  for (const item of actions) {
    if (item.environmentId !== environmentId) continue;
    if (!await send(item).catch(() => false)) break;
    done.add(item.id);
  }
  return actions.filter((item) => !done.has(item.id));
}

/** The paired computers that do not answer now, for Home's "Reconnecting to …" line. */
export function unreachableEnvironments(environments: readonly Environment[], connection: Record<string, RemoteConnection | undefined>): { environment: Environment; connecting: boolean }[] {
  return environments
    .filter((item) => (item.token || item.id === HOME_ENVIRONMENT) && connection[item.id] !== "open" && connection[item.id] !== undefined && connection[item.id] !== "idle")
    .map((environment) => ({ environment, connecting: connection[environment.id] === "connecting" }));
}

/** The Snoozed page's computer filter: every computer, or one. */
export type EnvironmentFilter = "all" | string;

export function filterByEnvironment<T extends { id: string }>(items: readonly T[], environmentOf: ReadonlyMap<string, string>, filter: EnvironmentFilter, storeId: string): T[] {
  if (filter === "all") return [...items];
  return items.filter((item) => (environmentOf.get(item.id) ?? storeId) === filter);
}
