import { create } from "zustand";
import {
  activeEnvironmentId,
  environmentClient,
  environmentTransport,
  forgetEnvironmentTransport,
  isRemoteUi,
  onEnvironmentConnection,
  switchEnvironment,
} from "@/client";
import { deviceName, redeemPairingAt } from "@/client/remote-pairing";
import { sharePushWith } from "@/client/remote-push";
import type { RemoteConnection } from "@/client/remote-transport";
import type { AppSettings } from "@/client/types";
import {
  HOME_ENVIRONMENT,
  environmentLabel,
  applyRowSettingsAction,
  applySessionUpdate,
  normalizeBaseUrl,
  pairedEnvironment,
  readEnvironments,
  readSummaries,
  removeEnvironment,
  renameEnvironment,
  summarize,
  summaryWithSettings,
  summaryWithoutSession,
  upsertEnvironment,
  writeEnvironments,
  writeSummaries,
  type Environment,
  type EnvironmentSummary,
  flushPendingActions,
  queueRowAction,
  readPendingActions,
  writePendingActions,
  type PendingRowAction,
  type RowAction,
} from "@/lib/environments";
import { cloneParentFor, moveBranch } from "@/lib/computers";
import { formatUnknownError } from "@/lib/format-error";
import { knownProjectRemote, travellingMessages } from "@/lib/phone-continue";
import { retargetQueued } from "@/lib/phone-outbox";
import { mergeSettings } from "@/lib/settings";
import { hostKind } from "@/lib/phone-host";
import { useAppStore } from "./app-store";

/**
 * The computers this phone talks to (ADR-132). One of them is active: the main store and
 * `client` belong to it. The others are watched through their own lightweight clients, which
 * keep a summary of their conversations for the merged Home (and, cached, for when they are
 * out of reach).
 */
interface EnvironmentsState {
  environments: Environment[];
  /** The computer `client` talks to. */
  activeId: string;
  /** The computer whose data the main store holds (it trails `activeId` while switching). */
  storeId: string;
  connection: Record<string, RemoteConnection>;
  summaries: Record<string, EnvironmentSummary>;
  /** The computer being switched to, while its data loads. */
  switchingTo: string | null;
  start: () => () => void;
  activate: (id: string) => Promise<boolean>;
  addComputer: (address: string, code: string) => Promise<Environment>;
  rename: (id: string, label: string) => void;
  forget: (id: string) => Promise<void>;
  /**
   * Runs a conversation's swipe or menu action on a computer that is not the active one, through
   * its own client, without switching; that computer's summary follows. False when it failed
   * (the error is shown) or the computer is out of reach.
   */
  sessionAction: (environmentId: string, sessionId: string, action: EnvironmentSessionAction) => Promise<boolean>;
  /**
   * Row actions waiting for their computer to come back (ADR-132 addendum): queued on the phone,
   * applied in order when it answers again, shown with a pending mark until then.
   */
  pending: PendingRowAction[];
  queueAction: (environmentId: string, sessionId: string, action: EnvironmentSessionAction) => void;
  /**
   * Continues a conversation of the active computer, out of reach, on another one (ADR-133
   * addendum): the project there (found or cloned from GitHub), a new session with the transcript
   * on the conversation's branch as GitHub has it, the waiting messages moved along. Switches to
   * that computer and returns the new conversation's id.
   */
  continueOn: (targetId: string, sessionId: string) => Promise<string>;
}

/** What a row on another computer can ask of it: the same native commands the store uses. */
export type EnvironmentSessionAction = RowAction;

export class EnvironmentError extends Error {
  readonly key: string;
  constructor(key: string) { super(key); this.key = key; }
}

// The native app names its home computer instead of being served by it (ADR-134).
const origin = () => window.location.origin;
const initial = isRemoteUi ? readEnvironments(window.localStorage, origin()) : [];
const watchers = new Map<string, () => void>();
/** Computers this launch already gave this app's alert subscription to. */
const pushShared = new Set<string>();
/** Each watched computer's full settings (archive and pin lists are per computer) and its reload. */
const settingsOf = new Map<string, AppSettings>();
const reloaders = new Map<string, () => Promise<void>>();
let summaryTimer: ReturnType<typeof setTimeout> | null = null;

export const useEnvironments = create<EnvironmentsState>()((set, get) => {
  /** Counts switches: only the latest may clear the busy state (a slow one can finish after it). */
  let activation = 0;
  const saveSummaries = () => {
    if (summaryTimer) clearTimeout(summaryTimer);
    summaryTimer = setTimeout(() => { summaryTimer = null; writeSummaries(window.localStorage, get().summaries); }, 1000);
  };
  const setSummary = (id: string, change: (current: EnvironmentSummary | undefined) => EnvironmentSummary | undefined) => {
    set((state) => {
      const next = change(state.summaries[id]);
      if (!next || next === state.summaries[id]) return {};
      return { summaries: { ...state.summaries, [id]: next } };
    });
    saveSummaries();
  };
  const saveList = (environments: Environment[]) => {
    writeEnvironments(window.localStorage, environments);
    set({ environments });
  };
  const noteHost = (id: string, info: { capabilities?: unknown; hostName?: string } | null | undefined) => {
    if (!info) return;
    const kind = hostKind(info as Parameters<typeof hostKind>[0]);
    const hostName = info.hostName?.trim() ?? "";
    const current = get().environments;
    const known = current.find((item) => item.id === id);
    if (!known || (known.kind === kind && (known.hostName === hostName || !hostName))) return;
    saveList(current.map((item) => item.id === id ? { ...item, kind, hostName: hostName || item.hostName } : item));
  };
  /** The active computer's live data as a summary, for when it stops being the active one. */
  const snapshotStore = () => {
    const app = useAppStore.getState();
    const id = get().storeId;
    if (!app.ready || !app.projects.length && !app.sessions.length) return;
    setSummary(id, () => summarize({ sessions: app.sessions, projects: app.projects, archivedSessionIds: app.settings.archivedSessionIds, pinnedSessionIds: app.settings.pinnedSessionIds }));
  };
  const unwatch = (id: string) => {
    watchers.get(id)?.();
    watchers.delete(id);
    reloaders.delete(id);
    settingsOf.delete(id);
  };
  /** Keeps a summary of a computer that is not the active one, live while it answers. */
  const watch = (id: string) => {
    if (watchers.has(id) || id === get().activeId) return;
    const other = environmentClient(id);
    const transport = environmentTransport(id);
    if (!other || !transport) return;
    let stopped = false;
    const load = async () => {
      try {
        const [data, info] = await Promise.all([other.loadState(), other.hostInfo().catch(() => null)]);
        if (stopped) return;
        settingsOf.set(id, mergeSettings(data.settings));
        setSummary(id, () => summarize({ sessions: data.sessions, projects: data.projects, archivedSessionIds: data.settings.archivedSessionIds, pinnedSessionIds: data.settings.pinnedSessionIds }));
        noteHost(id, info);
      } catch { /* out of reach: the last summary stays */ }
    };
    const unlisteners = [
      other.onSessionUpdated((session) => setSummary(id, (current) => current ? applySessionUpdate(current, session) : current)),
      other.onSettingsChanged((settings) => {
        settingsOf.set(id, mergeSettings(settings));
        setSummary(id, (current) => current ? { ...current, archivedSessionIds: settings.archivedSessionIds ?? [], pinnedSessionIds: settings.pinnedSessionIds ?? [] } : current);
      }),
    ];
    const stopConnection = onEnvironmentConnection((changed, state, previous) => {
      if (changed === id && state === "open" && previous !== "open") void load();
    });
    if (transport.connection === "open") void load();
    reloaders.set(id, load);
    watchers.set(id, () => {
      stopped = true;
      stopConnection();
      for (const unlisten of unlisteners) void unlisten.then((stop) => stop(), () => undefined);
    });
  };

  /** Applies a computer's waiting row actions once it answers: on the store when it is the active one. */
  let flushing = false;
  const flushPending = async (id: string) => {
    if (flushing || !get().pending.some((item) => item.environmentId === id)) return;
    flushing = true;
    try {
      const before = get().pending;
      const left = await flushPendingActions(before, id, async ({ sessionId, action }) => {
        if (id !== get().storeId) return get().sessionAction(id, sessionId, action);
        const app = useAppStore.getState();
        switch (action.type) {
          case "archive": app.requestArchive(sessionId, true); return true;
          case "unarchive": case "pin": case "unpin":
            return app.saveSettings(applyRowSettingsAction(app.settings, action.type, sessionId)).then(() => true, () => false);
          case "snooze": return app.snoozeSession(sessionId, action.until);
          case "rename": return app.renameSession(sessionId, action.title);
          case "auto-archive": return app.setSessionAutoArchive(sessionId, action.enabled);
          case "delete": return app.deleteSession(sessionId, action.removeWorktree);
        }
      });
      // Only what was sent leaves; actions queued meanwhile stay.
      const kept = new Set(left.map((item) => item.id));
      const sent = new Set(before.filter((item) => !kept.has(item.id)).map((item) => item.id));
      const next = get().pending.filter((item) => !sent.has(item.id));
      writePendingActions(window.localStorage, next);
      set({ pending: next });
    } finally {
      flushing = false;
    }
  };

  return {
    environments: initial,
    activeId: isRemoteUi ? activeEnvironmentId() : HOME_ENVIRONMENT,
    storeId: isRemoteUi ? activeEnvironmentId() : HOME_ENVIRONMENT,
    connection: {},
    summaries: isRemoteUi ? readSummaries(window.localStorage) : {},
    switchingTo: null,
    pending: isRemoteUi ? readPendingActions(window.localStorage) : [],

    queueAction: (environmentId, sessionId, action) => {
      const pending = queueRowAction(get().pending, { environmentId, sessionId, action });
      writePendingActions(window.localStorage, pending);
      set({ pending });
    },

    start: () => {
      if (!isRemoteUi) return () => undefined;
      // A computer that cannot be reached when the app opens gives way, once, to one that can.
      let fallback = get().environments.length > 1;
      let activeFailed = false;
      set({ connection: Object.fromEntries(get().environments.map((item) => [item.id, environmentTransport(item.id)?.connection ?? "idle"])) });
      const stopConnection = onEnvironmentConnection((id, state) => {
        set((current) => ({ connection: { ...current.connection, [id]: state } }));
        if (state === "open") void flushPending(id);
        // That computer alerts this app too, once per launch (ADR-132 addendum).
        if (state === "open" && id !== HOME_ENVIRONMENT && !pushShared.has(id)) {
          const environment = get().environments.find((item) => item.id === id);
          if (environment?.token) void sharePushWith(environment.baseUrl, environment.token).then((shared) => { if (shared) pushShared.add(id); });
        }
        if (!fallback) return;
        if (id === get().activeId) {
          if (state === "open") fallback = false;
          if (state === "lost") activeFailed = true;
        } else if (activeFailed && state === "open") {
          fallback = false;
          void get().activate(id);
        }
      });
      for (const environment of get().environments) if (environment.token) watch(environment.id);
      // The active computer's name and kind, and its conversations for the offline Home.
      let liveTimer: ReturnType<typeof setTimeout> | null = null;
      const stopStore = useAppStore.subscribe((state, previous) => {
        if (state.hostInfo !== previous.hostInfo) noteHost(get().storeId, state.hostInfo);
        if (state.ready && (state.sessions !== previous.sessions || state.projects !== previous.projects || state.settings !== previous.settings) && !get().switchingTo) {
          if (liveTimer) clearTimeout(liveTimer);
          liveTimer = setTimeout(() => { liveTimer = null; if (!get().switchingTo) snapshotStore(); }, 3000);
        }
      });
      return () => {
        stopConnection();
        stopStore();
        if (liveTimer) clearTimeout(liveTimer);
        for (const id of [...watchers.keys()]) unwatch(id);
      };
    },

    activate: async (id) => {
      const state = get();
      if (id === state.activeId && id === state.storeId) return true;
      const environment = state.environments.find((item) => item.id === id);
      if (!environment?.token || state.connection[id] === "unauthorized") return false;
      // Mid-switch the store holds part of the next computer's data: nothing to keep.
      if (!state.switchingTo) snapshotStore();
      const previous = state.activeId;
      unwatch(id);
      if (!switchEnvironment(id)) return false;
      const run = ++activation;
      set({ activeId: id, switchingTo: id });
      watch(previous);
      try {
        await useAppStore.getState().bootstrap();
      } finally {
        // A switch made meanwhile owns the store and the busy state now.
        if (run === activation) set({ storeId: id, switchingTo: null });
      }
      return true;
    },

    addComputer: async (address, code) => {
      const baseUrl = normalizeBaseUrl(address);
      if (!baseUrl) throw new EnvironmentError("environments.error.address");
      if (baseUrl === origin()) throw new EnvironmentError("environments.error.same");
      // A page served over HTTPS cannot open plain-HTTP sockets.
      if (window.isSecureContext && baseUrl.startsWith("http:") && origin().startsWith("https:")) throw new EnvironmentError("environments.error.https");
      const paired = await redeemPairingAt(baseUrl, code, deviceName(navigator.userAgent)).catch((error: unknown) => {
        if (error instanceof TypeError) throw new EnvironmentError("environments.error.unreachable");
        throw error;
      });
      const next = pairedEnvironment(baseUrl, paired.token, paired.host);
      const replaced = get().environments.find((item) => item.id !== HOME_ENVIRONMENT && (item.baseUrl === baseUrl || item.id === next.id));
      if (replaced) { unwatch(replaced.id); forgetEnvironmentTransport(replaced.id); }
      const environments = upsertEnvironment(get().environments, next);
      saveList(environments);
      const saved = environments.find((item) => item.baseUrl === baseUrl) ?? next;
      if (replaced && replaced.id === get().activeId) {
        // The active computer was paired again: move `client` to its new transport.
        switchEnvironment(saved.id);
        set({ activeId: saved.id, storeId: saved.id, switchingTo: saved.id });
        try { await useAppStore.getState().bootstrap(); } finally { set({ switchingTo: null }); }
        return saved;
      }
      watch(saved.id);
      return saved;
    },

    rename: (id, label) => saveList(renameEnvironment(get().environments, id, label)),

    forget: async (id) => {
      if (id === HOME_ENVIRONMENT) return;
      if (get().activeId === id) await get().activate(HOME_ENVIRONMENT);
      unwatch(id);
      forgetEnvironmentTransport(id);
      saveList(removeEnvironment(get().environments, id));
      set((state) => {
        const summaries = { ...state.summaries };
        const connection = { ...state.connection };
        delete summaries[id];
        delete connection[id];
        return { summaries, connection };
      });
      saveSummaries();
    },

    continueOn: async (targetId, sessionId) => {
      const state = get();
      const sourceId = state.storeId;
      const app = useAppStore.getState();
      const session = app.sessions.find((item) => item.id === sessionId);
      const target = environmentClient(targetId);
      if (!session || !target || state.connection[targetId] !== "open") throw new EnvironmentError("continue.error.unreachable");
      const messages = travellingMessages(session.messages);
      if (!messages.length) throw new EnvironmentError("continue.error.empty");
      const source = state.environments.find((item) => item.id === sourceId);
      // The project there by its GitHub address; without one noted, a project of the same name.
      const remoteUrl = knownProjectRemote(sourceId, session.projectId);
      const name = app.projects.find((item) => item.id === session.projectId)?.name;
      let project = remoteUrl ? await target.findProjectByRemote(remoteUrl) : (await target.loadState()).projects.find((item) => item.name === name) ?? null;
      if (!project && !remoteUrl) throw new EnvironmentError("continue.error.noRemote");
      if (!project && remoteUrl) project = await target.cloneProject(remoteUrl, cloneParentFor(await target.hostInfo().catch(() => null)));
      if (!project) throw new EnvironmentError("continue.error.noRemote");
      const created = await target.importSession({
        projectId: project.id,
        branch: moveBranch(session.id),
        title: session.title.trim() || project.name,
        agent: session.agent,
        model: session.model ?? null,
        messages,
        fromComputer: source ? environmentLabel(source, "Mac") : "Mac",
        fromOrigin: session.worktree.branch || null,
      });
      retargetQueued(sessionId, created.id);
      if (!await get().activate(targetId)) throw new EnvironmentError("continue.error.unreachable");
      return created.id;
    },

    sessionAction: async (environmentId, sessionId, action) => {
      const state = get();
      const other = environmentClient(environmentId);
      if (environmentId === state.storeId || !other || state.connection[environmentId] !== "open") return false;
      try {
        switch (action.type) {
          case "archive":
          case "unarchive":
          case "pin":
          case "unpin": {
            const current = settingsOf.get(environmentId) ?? mergeSettings((await other.loadState()).settings);
            const saved = mergeSettings(await other.saveSettings(applyRowSettingsAction(current, action.type, sessionId)));
            settingsOf.set(environmentId, saved);
            setSummary(environmentId, (summary) => summary ? summaryWithSettings(summary, saved) : summary);
            // As on the active computer: archiving can hand an isolated worktree back.
            const session = get().summaries[environmentId]?.sessions.find((item) => item.id === sessionId);
            if (action.type === "archive" && saved.releaseWorktreeOnArchive && saved.archivedSessionIds.includes(sessionId) && session?.worktree.isolated) {
              await other.releaseArchivedWorktree(sessionId).catch((error: unknown) => useAppStore.setState({ error: formatUnknownError(error) }));
            }
            break;
          }
          case "snooze":
          case "rename":
          case "auto-archive": {
            const updated = action.type === "snooze" ? await other.snoozeSession(sessionId, action.until)
              : action.type === "rename" ? await other.renameSession(sessionId, action.title.trim())
              : await other.setSessionAutoArchive(sessionId, action.enabled);
            setSummary(environmentId, (summary) => summary ? applySessionUpdate(summary, updated) : summary);
            break;
          }
          case "delete":
            await other.deleteSession(sessionId, action.removeWorktree, true);
            setSummary(environmentId, (summary) => summary ? summaryWithoutSession(summary, sessionId) : summary);
            break;
        }
      } catch (error) {
        useAppStore.setState({ error: formatUnknownError(error) });
        return false;
      }
      // That computer's list again, for what the action moved (side chats, auto-archive, order).
      void reloaders.get(environmentId)?.();
      return true;
    },
  };
});

/** Whether a computer counts as out of reach for its rows (still connecting is not). */
export function environmentOffline(connection: RemoteConnection | undefined): boolean {
  return connection === "lost" || connection === "unauthorized";
}
