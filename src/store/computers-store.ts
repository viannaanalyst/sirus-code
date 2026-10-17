import { create } from "zustand";
import {
  client,
  environmentClient,
  environmentTransport,
  forgetEnvironmentTransport,
  isRemoteUi,
  localClient,
  onEnvironmentConnection,
  switchEnvironment,
  type SirusClient,
} from "@/client";
import { redeemPairingAt } from "@/client/remote-pairing";
import type { RemoteConnection } from "@/client/remote-transport";
import type { HostInfo, Project, Session } from "@/client/types";
import { LAST_TARGET_KEY, cloneParentFor, lastTarget, moveRefusal, type MoveRefusal } from "@/lib/computers";
import {
  HOME_ENVIRONMENT,
  applySessionUpdate,
  environmentLabel,
  normalizeBaseUrl,
  pairedEnvironment,
  readEnvironments,
  removeEnvironment,
  renameEnvironment,
  summarize,
  upsertEnvironment,
  writeEnvironments,
  type Environment,
  type EnvironmentSummary,
} from "@/lib/environments";
import { formatUnknownError } from "@/lib/format-error";
import { hostKind } from "@/lib/phone-host";
import { resetComputerScope, useAppStore } from "./app-store";

/**
 * The desktop app's computers (ADR-133): this Mac plus the Sirus hosts paired from Settings →
 * Connections. One is active (the main store and `client` belong to it); the others are watched
 * through their own clients for the project switcher's groups. The list and tokens live in the
 * webview's local storage under the phone's keys (`lib/environments.ts`).
 */
export type MoveStep = "check" | "project" | "push" | "import" | "open";

interface ComputersState {
  computers: Environment[];
  activeId: string;
  connection: Record<string, RemoteConnection>;
  summaries: Record<string, EnvironmentSummary>;
  hostInfo: Record<string, HostInfo | null>;
  switchingTo: string | null;
  moving: { sessionId: string; targetId: string; step: MoveStep } | null;
  start: () => () => void;
  activate: (id: string) => Promise<boolean>;
  addComputer: (address: string, code: string) => Promise<Environment>;
  rename: (id: string, label: string) => void;
  forget: (id: string) => Promise<void>;
  openProject: (computerId: string, projectId: string) => Promise<void>;
  openSession: (computerId: string, sessionId: string) => Promise<void>;
  /** Makes a computer the one new projects and clones go to (and remembers it). */
  chooseTarget: (id: string) => Promise<boolean>;
  /** Why a conversation of the active computer cannot move to `targetId` now, or null. */
  moveRefusal: (sessionId: string, targetId: string, remoteUrl?: string | null) => MoveRefusal | null;
  moveSession: (sessionId: string, targetId: string) => Promise<boolean>;
  /** The "Move to" confirmation on screen (one dialog for every menu). */
  moveRequest: { sessionId: string; targetId: string } | null;
  requestMove: (sessionId: string, targetId: string) => void;
  cancelMove: () => void;
}

export class ComputerError extends Error {
  readonly key: string;
  constructor(key: string) { super(key); this.key = key; }
}

const storage = () => window.localStorage;
const origin = () => window.location.origin;
const watchers = new Map<string, () => void>();
/** Computers this launch already gave the Mac's alert key to. */
const pushKeyShared = new Set<string>();

/** A computer's client: this Mac's own IPC, or the paired host's socket. */
function clientOf(id: string): SirusClient | null {
  return id === HOME_ENVIRONMENT ? localClient : environmentClient(id);
}

export const useComputers = create<ComputersState>()((set, get) => {
  /** Counts switches: only the latest may clear the busy state (a slow one can finish after it). */
  let activation = 0;
  const saveList = (computers: Environment[]) => {
    writeEnvironments(storage(), computers);
    set({ computers });
  };
  const setSummary = (id: string, change: (current: EnvironmentSummary | undefined) => EnvironmentSummary | undefined) => set((state) => {
    const next = change(state.summaries[id]);
    return next && next !== state.summaries[id] ? { summaries: { ...state.summaries, [id]: next } } : {};
  });
  const noteHost = (id: string, info: HostInfo | null) => {
    set((state) => ({ hostInfo: { ...state.hostInfo, [id]: info } }));
    if (!info || id === HOME_ENVIRONMENT) return;
    const kind = hostKind(info);
    const hostName = info.hostName?.trim() ?? "";
    const known = get().computers.find((item) => item.id === id);
    if (!known || (known.kind === kind && (known.hostName === hostName || !hostName))) return;
    saveList(get().computers.map((item) => item.id === id ? { ...item, kind, hostName: hostName || item.hostName } : item));
  };
  const snapshotStore = () => {
    const app = useAppStore.getState();
    if (!app.ready) return;
    setSummary(get().activeId, () => summarize({ sessions: app.sessions, projects: app.projects, archivedSessionIds: app.settings.archivedSessionIds, pinnedSessionIds: app.settings.pinnedSessionIds }));
  };
  const unwatch = (id: string) => { watchers.get(id)?.(); watchers.delete(id); };
  /** Keeps a summary of a computer that is not the active one, live while it answers. */
  const watch = (id: string) => {
    if (watchers.has(id) || id === get().activeId) return;
    const other = clientOf(id);
    if (!other) return;
    let stopped = false;
    const load = async () => {
      try {
        const [data, info] = await Promise.all([other.loadState(), other.hostInfo().catch(() => null)]);
        if (stopped) return;
        setSummary(id, () => summarize({ sessions: data.sessions, projects: data.projects, archivedSessionIds: data.settings.archivedSessionIds, pinnedSessionIds: data.settings.pinnedSessionIds }));
        noteHost(id, info);
        // That computer can then alert the phone app installed from this Mac (ADR-132 addendum).
        const computer = get().computers.find((item) => item.id === id);
        if (id !== HOME_ENVIRONMENT && computer?.token && !pushKeyShared.has(id)) {
          void localClient?.sharePushIdentity(computer.baseUrl, computer.token).then(() => { pushKeyShared.add(id); }, () => undefined);
        }
      } catch { /* out of reach: the last summary stays */ }
    };
    const unlisteners = [
      other.onSessionUpdated((session) => setSummary(id, (current) => current ? applySessionUpdate(current, session) : current)),
      other.onSettingsChanged((settings) => setSummary(id, (current) => current ? { ...current, archivedSessionIds: settings.archivedSessionIds ?? [], pinnedSessionIds: settings.pinnedSessionIds ?? [] } : current)),
    ];
    const stopConnection = onEnvironmentConnection((changed, state, previous) => {
      if (changed === id && state === "open" && previous !== "open") void load();
    });
    if (id === HOME_ENVIRONMENT || environmentTransport(id)?.connection === "open") void load();
    watchers.set(id, () => {
      stopped = true;
      stopConnection();
      for (const unlisten of unlisteners) void unlisten.then((stop) => stop(), () => undefined);
    });
  };
  const labelOf = (id: string) => {
    const computer = get().computers.find((item) => item.id === id);
    if (!computer) return "?";
    if (id === HOME_ENVIRONMENT) return computer.label.trim() || get().hostInfo[HOME_ENVIRONMENT]?.hostName?.trim() || "Mac";
    return environmentLabel(computer, "Server");
  };
  const fail = (error: unknown) => { useAppStore.setState({ error: formatUnknownError(error) }); };

  return {
    computers: isRemoteUi || typeof window === "undefined" ? [] : readEnvironments(storage(), origin()),
    activeId: HOME_ENVIRONMENT,
    connection: {},
    summaries: {},
    hostInfo: {},
    switchingTo: null,
    moving: null,
    moveRequest: null,
    requestMove: (sessionId, targetId) => set({ moveRequest: { sessionId, targetId } }),
    cancelMove: () => { if (!get().moving) set({ moveRequest: null }); },

    start: () => {
      if (isRemoteUi || typeof window === "undefined") return () => undefined;
      const stopConnection = onEnvironmentConnection((id, state, previous) => {
        set((current) => ({ connection: { ...current.connection, [id]: state } }));
        // The active server came back: what changed there meanwhile loads in place.
        if (id === get().activeId && state === "open" && previous === "lost" && !get().switchingTo) void useAppStore.getState().bootstrap();
      });
      set({ connection: Object.fromEntries(get().computers.filter((item) => item.id !== HOME_ENVIRONMENT).map((item) => [item.id, environmentTransport(item.id)?.connection ?? "idle"])) });
      for (const computer of get().computers) if (computer.id !== HOME_ENVIRONMENT && computer.token) watch(computer.id);
      void localClient?.hostInfo().then((info) => noteHost(HOME_ENVIRONMENT, info), () => undefined);
      const stopStore = useAppStore.subscribe((state, previous) => {
        if (state.hostInfo !== previous.hostInfo && !get().switchingTo) noteHost(get().activeId, state.hostInfo);
      });
      return () => {
        stopConnection();
        stopStore();
        for (const id of [...watchers.keys()]) unwatch(id);
      };
    },

    activate: async (id) => {
      const state = get();
      if (id === state.activeId) return true;
      const computer = state.computers.find((item) => item.id === id);
      if (!computer || (id !== HOME_ENVIRONMENT && (!computer.token || state.connection[id] === "unauthorized"))) return false;
      // Mid-switch the window holds part of the next computer's data: nothing to keep.
      if (!state.switchingTo) snapshotStore();
      const previous = state.activeId;
      unwatch(id);
      if (!switchEnvironment(id)) return false;
      const run = ++activation;
      set({ activeId: id, switchingTo: id });
      watch(previous);
      // Per-computer state the bootstrap does not reset: editor apps are detected again there.
      resetComputerScope();
      try {
        await useAppStore.getState().bootstrap();
      } finally {
        // A switch made meanwhile owns the busy state now.
        if (run === activation) set({ switchingTo: null });
      }
      return true;
    },

    addComputer: async (address, code) => {
      const baseUrl = normalizeBaseUrl(address);
      if (!baseUrl) throw new ComputerError("environments.error.address");
      // The desktop's page is a secure context: it can only open HTTPS and WSS connections.
      if (!baseUrl.startsWith("https:")) throw new ComputerError("environments.error.https");
      const paired = await redeemPairingAt(baseUrl, code, `Sirus desktop · ${labelOf(HOME_ENVIRONMENT)}`).catch((error: unknown) => {
        if (error instanceof TypeError) throw new ComputerError("environments.error.unreachable");
        throw error;
      });
      const next = pairedEnvironment(baseUrl, paired.token, paired.host);
      const replaced = get().computers.find((item) => item.id !== HOME_ENVIRONMENT && (item.baseUrl === baseUrl || item.id === next.id));
      if (replaced) {
        if (replaced.id === get().activeId) await get().activate(HOME_ENVIRONMENT);
        unwatch(replaced.id);
        forgetEnvironmentTransport(replaced.id);
      }
      const computers = upsertEnvironment(get().computers, next);
      saveList(computers);
      const saved = computers.find((item) => item.baseUrl === baseUrl) ?? next;
      set((state) => ({ connection: { ...state.connection, [saved.id]: environmentTransport(saved.id)?.connection ?? "idle" } }));
      watch(saved.id);
      return saved;
    },

    rename: (id, label) => saveList(renameEnvironment(get().computers, id, label)),

    forget: async (id) => {
      if (id === HOME_ENVIRONMENT) return;
      if (get().activeId === id) await get().activate(HOME_ENVIRONMENT);
      unwatch(id);
      forgetEnvironmentTransport(id);
      saveList(removeEnvironment(get().computers, id));
      if (storage().getItem(LAST_TARGET_KEY) === id) storage().removeItem(LAST_TARGET_KEY);
      set((state) => {
        const summaries = { ...state.summaries };
        const connection = { ...state.connection };
        delete summaries[id];
        delete connection[id];
        return { summaries, connection };
      });
    },

    openProject: async (computerId, projectId) => {
      if (computerId !== get().activeId && !(await get().activate(computerId))) return;
      const store = useAppStore.getState();
      store.setMainView("session");
      await store.switchProject(projectId).catch(fail);
    },

    openSession: async (computerId, sessionId) => {
      if (computerId !== get().activeId && !(await get().activate(computerId))) return;
      const store = useAppStore.getState();
      store.setMainView("session");
      await store.selectSession(sessionId).catch(fail);
    },

    chooseTarget: async (id) => {
      const ok = await get().activate(id);
      if (ok) storage().setItem(LAST_TARGET_KEY, id);
      return ok;
    },

    moveRefusal: (sessionId, targetId, remoteUrl) => {
      const session = useAppStore.getState().sessions.find((item) => item.id === sessionId);
      if (!session) return "same";
      return moveRefusal({ session, sourceId: get().activeId, targetId, targetConnection: get().connection[targetId], remoteUrl });
    },

    moveSession: async (sessionId, targetId) => {
      const sourceId = get().activeId;
      const session: Session | undefined = useAppStore.getState().sessions.find((item) => item.id === sessionId);
      const target = clientOf(targetId);
      if (!session || !target || get().moving) return false;
      const step = (next: MoveStep) => set({ moving: { sessionId, targetId, step: next } });
      try {
        step("check");
        const remoteUrl = await client.projectRemoteUrl(session.projectId);
        const refusal = get().moveRefusal(sessionId, targetId, remoteUrl);
        if (refusal || !remoteUrl) throw new ComputerError(`computers.move.refused.${refusal ?? "noRemote"}`);
        // 1. The project on the target, found by its GitHub address or cloned there.
        step("project");
        let project: Project | null = await target.findProjectByRemote(remoteUrl);
        if (!project) {
          const info = await target.hostInfo().catch(() => null);
          project = await target.cloneProject(remoteUrl, cloneParentFor(info));
        }
        // 2. The conversation's work, committed on a private index and pushed as `sirus/move-…`.
        step("push");
        const targetLabel = labelOf(targetId);
        const exported = await client.prepareSessionMove(sessionId, targetLabel);
        // 3. A session there on that branch, with the transcript and a recap for its first turn.
        step("import");
        const created = await target.importSession({
          projectId: project.id,
          branch: exported.branch,
          title: exported.title,
          agent: exported.agent,
          model: exported.model,
          messages: exported.messages,
          fromComputer: labelOf(sourceId),
        });
        // 4. Noted here, then opened there.
        await client.markSessionMoved(sessionId, targetLabel, exported.branch).catch(fail);
        step("open");
        if (await get().activate(targetId)) {
          const store = useAppStore.getState();
          if (!store.sessions.some((item) => item.id === created.id)) await store.bootstrap();
          await get().openSession(targetId, created.id);
        }
        return true;
      } catch (error) {
        if (error instanceof ComputerError) throw error;
        fail(error);
        return false;
      } finally {
        set({ moving: null });
      }
    },
  };
});

/** The computer's name as the window shows it. */
export function computerLabel(id: string): string {
  const state = useComputers.getState();
  const computer = state.computers.find((item) => item.id === id);
  if (!computer) return "?";
  if (id === HOME_ENVIRONMENT) return computer.label.trim() || state.hostInfo[HOME_ENVIRONMENT]?.hostName?.trim() || "Mac";
  return environmentLabel(computer, "Server");
}

/** The computer new projects go to by default: the last one chosen, if still paired. */
export function defaultTarget(): string {
  return lastTarget(storage(), useComputers.getState().computers);
}

/** Whether the window currently works on another computer than this Mac. */
export function useRemoteComputerActive(): boolean {
  return useComputers((state) => state.activeId !== HOME_ENVIRONMENT);
}
