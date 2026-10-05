import { appendDiffComment } from "@/lib/diff-comment";
import { activeSession, lastAssistantId, observedPromptAdmission, observedQueuedAdmission, PROMPT_QUEUE_LIMIT, queueBinding, sameQueueBinding, validQueuedPrompt, type PromptQueue } from "@/lib/prompt-queue";
import { acknowledgeEditorSave, editorKey } from "@/lib/editor-state";
import { SIDEBAR_MIN_WIDTH, SIDEBAR_RAIL_WIDTH } from "@/lib/sidebar-panels";
import { closeTab as closeTabRule, finishedUnseen, moveTab as moveTabRule, openTab as openTabRule, TAB_LIMIT, visibleTabSessions } from "@/lib/header-tabs";
import { retainActivityNotifications } from "@/lib/notifications";
import { initialSplit, leafShowing, splitDrop, splitLeaves, splitRemove, splitResize, splitSync, type SplitEdge, type SplitLayout, type SplitTarget } from "@/lib/split-layout";
import { activeProviderAccount } from "@/lib/provider-accounts";
import type { ComposerContext } from "@/lib/composer-context";
import { applyAgentOutput } from "@/lib/agent-events";
import { mergeLoadedTranscript, mergeSessionEvent, transcriptsToKeep } from "@/lib/transcripts";
import { appendAttachments } from "@/lib/composer-attachments";
import { canReadDocument } from "@/lib/document-reader";
import { composerContextForOwner, composerPrompt, emptyComposerContext } from "@/lib/composer-context";
import { supportsPlanning } from "@/lib/execution-options";
import { secondOpinionPrompt, secondOpinionTurn } from "@/lib/second-opinion";
import { appendTranscriptQuote } from "@/lib/transcript-selection";
import { createDraftWriter } from "@/lib/draft-persistence";
import { CONTEXT_TEXT_LIMIT, hasContextOwner, normalizeContextTexts } from "@/lib/context-text";
import { newId } from "@/lib/ids";
import { scanLocalServers } from "@/lib/local-servers";
import { pruneSidebarSettings, sidebarGroups } from "@/lib/sidebar-layout";
import type { PullRequestLoadState } from "@/lib/pull-requests";
import { create } from "zustand";
import { client } from "@/client";
import type {
  AgentInstall,
  BrowserBounds,
  BrowserSessionState,
  ComputerAction,
  ComputerSnapshot,
  ExecutionOptions,
  AgentEvent,
  AgentProviderId,
  AppSettings,
  HostInfo,
  FileChange,
  GitIdentity,
  GitStatus,
  Project,
  ProviderModelList,
  ProviderUsage,
  Session,
  WindowSnapEvent,
} from "@/client/types";
import { formatUnknownError } from "@/lib/format-error";
import { providerById, PROVIDERS } from "@/lib/provider-registry";
import {
  defaultSettings,
  mergeSettings,
  modelKey,
  parseModelKey,
  type SettingsSectionId,
} from "@/lib/settings";

export type DockPaneKind = "terminal" | "files" | "changes" | "editor" | "browser" | "document" | "review" | "sidechat";
export interface DockPane {
  id: string;
  kind: DockPaneKind;
  /** Editor panes are bound to the session that opened the file. */
  sessionId?: string;
  path?: string;
  review?: { messageId: string; path?: string };
  document?: { owner: string; scope: string; attachmentId: string; name: string };
}
export interface TerminalRef {
  id: string;
  number: number;
}
/** A split region; its terminals are tabs inside that region. */
export interface TerminalPane {
  id: string;
  terminals: TerminalRef[];
  activeTerminalId: string;
}
export interface TerminalWorkspace {
  split: "columns" | "rows";
  panes: TerminalPane[];
}
export function terminalCount(workspace: TerminalWorkspace | undefined): number {
  return (workspace?.panes ?? []).reduce((count, pane) => count + pane.terminals.length, 0);
}
function nextTerminal(workspace: TerminalWorkspace | undefined): TerminalRef {
  const numbers = (workspace?.panes ?? []).flatMap((pane) => pane.terminals.map((terminal) => terminal.number));
  return { id: newId(), number: numbers.reduce((max, number) => Math.max(max, number), 0) + 1 };
}
function newPane(terminal: TerminalRef): TerminalPane {
  return { id: newId(), terminals: [terminal], activeTerminalId: terminal.id };
}
function withWorkspace(
  state: { terminalWorkspacesBySession: Record<string, TerminalWorkspace> },
  sessionId: string,
  workspace: TerminalWorkspace,
) {
  return { terminalWorkspacesBySession: { ...state.terminalWorkspacesBySession, [sessionId]: workspace } };
}
/** Main column: conversation, Kanban board or the review inbox (ADR-050). */
export type MainView = "session" | "kanban" | "pulls" | "automations" | "inbox" | "tasks";
export interface NavEntry {
  settingsPage?: { section: SettingsSectionId } | null;
  mainView: MainView;
  projectId: string | null;
  sessionId: string | null;
}
/** Mirrors the native bound in commands.rs. */
export const MAX_TERMINALS_PER_SESSION = 8;
/** Bounded browser-style navigation history. */
const MAX_NAV_ENTRIES = 50;
/** Unsaved editor buffers survive pane/session switches until discarded. */
export interface EditorBuffer {
  identity: string;
  content: string;
  saved: string;
}
export type SettingsSection = SettingsSectionId;

interface AppStore {
  transcriptSearch: import("@/lib/conversation-search").TranscriptSearch | null;
  openTranscriptSearch: (scope?: "session" | "all") => void;
  updateTranscriptSearch: (change: Partial<Pick<import("@/lib/conversation-search").TranscriptSearch, "query" | "scope">>) => void;
  closeTranscriptSearch: () => void;
  addReviewComment: (sessionId: string, messageId: string, selection: import("@/lib/diff-comment").DiffComment) => boolean;
  activityNotifications: import("@/client/types").ActivityNotification[];
  providerAccounts: import("@/client/types").ProviderAccount[];
  selectedProviderAccounts: Partial<Record<AgentProviderId, string>>;
  addProviderAccount: (provider: AgentProviderId, name: string) => Promise<import("@/client/types").ProviderAccount>;
  selectProviderAccount: (provider: AgentProviderId, id: string) => Promise<void>;
  renameProviderAccount: (provider: AgentProviderId, id: string, name: string) => Promise<void>;
  ready: boolean;
  error: string | null;
  projects: Project[];
  sessions: Session[];
  settings: AppSettings;
  agents: AgentInstall[];
  modelsByProvider: Partial<Record<AgentProviderId, ProviderModelList>>;
  usageByProvider: Partial<Record<AgentProviderId, ProviderUsage>>;
  usageLoading: Partial<Record<AgentProviderId, boolean>>;
  refreshProviderUsage: (provider: AgentProviderId, force?: boolean) => Promise<void>;
  providerUpdates: import("@/client/types").ProviderUpdate[] | null;
  updatesChecking: boolean;
  updatesApplying: boolean;
  updateError: string | null;
  checkProviderUpdates: (force?: boolean) => Promise<void>;
  applyProviderUpdates: () => Promise<void>;
  importSessions: (sessions: Session[]) => void;
  refreshProjectGit: (projectId: string) => Promise<void>;
  consumeCodexReset: (offer: string) => Promise<import("@/client/types").CodexResetResult>;
  modelChangesPending: Record<string, number>;
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  mainView: MainView;
  setMainView: (view: MainView) => void;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  draftIsolated: boolean;
  /** The landing's Temporary toggle: the session its first send creates is deleted once left. */
  draftTemporary: boolean;
  setDraftTemporary: (temporary: boolean) => void;
  /** Temporary sessions (memory-only); each is deleted after the person leaves it and it settles. */
  temporarySessionIds: string[];
  composerDrafts: Record<string, string>;
  contextTexts: Record<string, string>;
  contextTextStatus: Record<string, { saving: boolean; error: string | null }>;
  setContextText: (key: string, value: string) => Promise<void>;
  flushContextText: (key: string) => Promise<void>;
  composerContexts: Record<string, ComposerContext>;
  promptQueues: Record<string, PromptQueue>;
  pausePromptQueue: (sessionId: string) => void;
  resumePromptQueue: (sessionId: string) => void;
  editQueuedPrompt: (sessionId: string, id: string, text: string) => boolean;
  cancelQueuedPrompt: (sessionId: string, id: string) => void;
  setComposerContext: (key: string, context: ComposerContext) => void;
  setComposerDraft: (key: string, value: string) => void;
  dockWidth: number;
  dockOpen: boolean;
  dockMaximized: boolean;
  dockPanes: DockPane[];
  dockActivePaneId: string | null;
  terminalWorkspacesBySession: Record<string, TerminalWorkspace>;
  localServersBySession: Record<string, string[]>;
  selectedFileBySession: Record<string, string | undefined>;
  editorBuffers: Record<string, EditorBuffer>;
  editorSaving: Record<string, boolean>;
  editors: import("@/client/types").EditorInstall[] | null;
  editorIcons: Record<string, string>;
  remoteUrlByProject: Record<string, string | null | undefined>;
  environmentOpen: boolean;
  navHistory: NavEntry[];
  navIndex: number;
  goBack: () => void;
  goForward: () => void;
  paletteOpen: boolean;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  newSessionOpen: boolean;
  gitByPath: Record<string, GitIdentity>;
  gitStatus: GitStatus | null;
  selectedDiff: FileChange | null;
  diffText: string | null;
  hostInfo: HostInfo | null;
  bootstrap: () => Promise<void>;
  refreshAgents: () => Promise<void>;
  addProjectFromPicker: () => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
  removeProject: (projectId: string) => Promise<void>;
  renameProject: (projectId: string, name: string) => Promise<boolean>;
  /** Folder colour, emoji or logo of a project (ADR-059); applied at once. */
  updateProjectLook: (action: import("@/client/types").ProjectLookAction) => Promise<boolean>;
  createSession: (
    agent: AgentProviderId,
    isolatedWorktree: boolean,
    title?: string,
    model?: string | null,
  ) => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  forkSession: (sessionId: string, messageId: string) => Promise<boolean>;
  handoffSession: (sessionId: string, messageId: string, agent: import("@/client/types").AgentProviderId, model: string | null) => Promise<boolean>;
  dismissHandoff: (sessionId: string) => Promise<boolean>;
  /**
   * Second opinion (ADR-056): a new session for `agent`/`model` in the same
   * workspace, opened beside the source, reviews the settled turn read-only.
   */
  secondOpinion: (sessionId: string, messageId: string, agent: AgentProviderId, model: string | null) => Promise<boolean>;
  browserBySession: Record<string, BrowserSessionState>;
  /** Native computer-use state (permissions, pending approvals, grants, history); memory-only. */
  computer: ComputerSnapshot | null;
  computerAction: (action: ComputerAction) => Promise<boolean>;
  loadBrowser: (sessionId: string) => Promise<void>;
  openBrowser: (sessionId: string) => Promise<boolean>;
  closeBrowser: (sessionId: string) => Promise<boolean>;
  browserNewTab: (sessionId: string, url?: string | null) => Promise<boolean>;
  browserCloseTab: (sessionId: string, tabId: string) => Promise<boolean>;
  browserSelectTab: (sessionId: string, tabId: string) => Promise<boolean>;
  browserNavigate: (sessionId: string, tabId: string, url: string) => Promise<boolean>;
  browserReload: (sessionId: string, tabId: string) => Promise<boolean>;
  browserBack: (sessionId: string, tabId: string) => Promise<boolean>;
  browserForward: (sessionId: string, tabId: string) => Promise<boolean>;
  setBrowserBounds: (sessionId: string, bounds: BrowserBounds | null) => void;
  browserAnnotateStart: (sessionId: string, tabId: string) => Promise<boolean>;
  browserAnnotateFinish: (sessionId: string, tabId: string) => Promise<import("@/client/types").BrowserAnnotation[] | null>;
  browserAnnotateCancel: (sessionId: string, tabId: string) => Promise<void>;
  browserCopyLink: (sessionId: string, tabId: string) => Promise<boolean>;
  browserCapture: (sessionId: string, tabId: string) => Promise<string | null>;
  browserHistoryBySession: Record<string, string[]>;
  noteBrowserUrl: (sessionId: string, url: string) => void;
  setMessagePinned: (sessionId: string, messageId: string, pinned: boolean) => Promise<boolean>;
  messageJump: { sessionId: string; messageId: string; sequence: number; searchStart?: number } | null;
  jumpToMessage: (sessionId: string, messageId: string, searchStart?: number) => Promise<void>;
  /** Sends to the selected session, or to `sessionId` (a side chat) when given. */
  sendPrompt: (prompt: string, execution?: ExecutionOptions, sessionId?: string) => Promise<boolean>;
  /** Review inbox lists per `${kind}:${state}` (ADR-050); memory-only, refreshed on demand. */
  githubInbox: Record<string, { data: import("@/client/types").GithubInbox | null; loading: boolean; error: string | null }>;
  loadGithubInbox: (kind: import("@/client/types").GithubItemKind, state: import("@/client/types").GithubItemState) => Promise<void>;
  /** Personal tasks (ADR-052); null until first loaded. */
  tasks: import("@/client/types").Task[] | null;
  /** Closed `task_action`; failures land in `error` and resolve null. */
  taskAction: (action: import("@/client/types").TaskAction) => Promise<import("@/client/types").Task[] | null>;
  /** Scheduled automations and recent runs (ADR-051); refreshed on `automations-changed`. */
  automations: import("@/client/types").AutomationSnapshot | null;
  /** Closed `automation_action`; failures land in `error` and resolve null. */
  automationAction: (action: import("@/client/types").AutomationAction) => Promise<import("@/client/types").AutomationSnapshot | null>;
  /** Closed `pull_request_action`; failures land in `error` and resolve null. */
  pullRequestAction: (action: import("@/client/types").PullRequestAction) => Promise<import("@/client/types").PullRequestResponse | null>;
  /** Opens (or reuses) the parent's side chat in the right dock (ADR-049); `quote` starts its draft. */
  openSideChat: (parentSessionId: string, quote?: string) => Promise<boolean>;
  /** ⌥⌘S: shows the selected session's side chat, or hides it when it is showing. */
  toggleSideChat: () => void;
  renameSession: (sessionId: string, title: string) => Promise<boolean>;
  deleteSession: (sessionId: string, removeWorktree: boolean) => Promise<boolean>;
  respondAgentRequest: (request: import("@/client/types").RespondAgentRequest) => Promise<boolean>;
  stopAgent: (sessionId?: string) => Promise<void>;
  /** Closed team actions (ADR-043); upserts returned sessions and drops removed workers. */
  teamAction: (action: import("@/client/types").TeamAction) => Promise<boolean>;
  refreshGitStatus: () => Promise<void>;
  loadDiff: (change: FileChange) => Promise<void>;
  setSidebarWidth: (width: number) => void;
  resizeSidebar: (delta: number) => void;
  toggleSidebar: () => void;
  setDraftIsolated: (isolated: boolean) => void;
  setEnvironmentOpen: (open: boolean) => void;
  toggleEnvironment: () => void;
  setDockWidth: (width: number) => void;
  toggleDock: () => void;
  toggleDockMaximized: () => void;
  openDockPane: (kind: DockPaneKind, path?: string) => void;
  openTurnReview: (sessionId: string, messageId: string, path?: string) => void;
  keepTurnChanges: (sessionId: string, messageId: string) => Promise<void>;
  openAttachmentReader: (scope: string, attachment: import("@/client/types").PromptAttachment) => void;
  closeDockPane: (paneId: string) => void;
  setActiveDockPane: (paneId: string) => void;
  ensureTerminal: (sessionId: string) => void;
  addTerminalTab: (sessionId: string, paneId: string) => void;
  setActiveTerminal: (sessionId: string, paneId: string, terminalId: string) => void;
  closeTerminal: (sessionId: string, terminalId: string) => void;
  splitTerminalPane: (sessionId: string, paneId: string, split: "columns" | "rows") => void;
  moveTerminalToOwnPane: (sessionId: string, paneId: string) => void;
  noteLocalServers: (sessionId: string, urls: string[]) => void;
  setSelectedFile: (sessionId: string, path: string) => void;
  setEditorBuffer: (key: string, content: string, saved?: string) => void;
  saveEditorBuffer: (sessionId: string, path: string) => Promise<void>;
  discardEditorBuffer: (key: string) => void;
  loadEditors: () => Promise<void>;
  loadProjectRemote: (projectId: string) => Promise<void>;
  pullRequestsBySession: Record<string, PullRequestLoadState>;
  refreshPullRequest: (sessionId: string, force?: boolean) => Promise<void>;
  setPaletteOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setSettingsSection: (section: SettingsSection) => void;
  requestNewSession: () => void;
  /** Outcome of the latest global window snap, shown as a toast (ADR-054). */
  windowSnapNotice: { id: number; kind: "added" | "permission" | "own" | "failed" | "noComposer"; app?: string } | null;
  /** Side-by-side conversations (memory-only); the active pane always shows the selected session. */
  splitLayout: SplitLayout;
  /** The conversation being dragged toward the panes and where it would land. */
  splitDrag: { sessionId: string; drop: SplitTarget | null; state: "ok" | "full" | "none" } | null;
  setSplitDrag: (drag: AppStore["splitDrag"]) => void;
  dropOnSplit: (sessionId: string, drop: SplitTarget) => void;
  /** Opens a conversation beside the active pane (keyboard and menu alternative to dragging). */
  openInSplit: (sessionId: string, edge: Exclude<SplitEdge, "center">) => void;
  activateSplitPane: (leafId: string) => void;
  closeSplitPane: (leafId: string) => void;
  resizeSplit: (branchId: string, ratio: number) => void;
  /** Header tabs (memory-only): a per-project view over sessions; closing a tab never changes the session. */
  openTabsByProject: Record<string, string[]>;
  lastActiveTabByProject: Record<string, string>;
  closedTabs: { projectId: string; sessionId: string; index: number }[];
  /** A blank "New session" tab per project while its landing is open; the first send turns it into the session's tab. */
  draftTabByProject: Record<string, boolean>;
  closeDraftTab: (projectId: string) => void;
  unseenSessionIds: string[];
  /** Sessions whose full transcript is in memory, with a recency tick (ADR-048). */
  loadedTranscripts: Record<string, number>;
  /** Loads a session's transcript once; resolves false when it cannot be loaded. */
  ensureTranscript: (sessionId: string, refresh?: boolean) => Promise<boolean>;
  projectSwitcherOpen: boolean;
  setProjectSwitcherOpen: (open: boolean) => void;
  closeHeaderTab: (projectId: string, sessionId: string) => void;
  closeOtherHeaderTabs: (projectId: string, sessionId: string) => void;
  closeHeaderTabsToRight: (projectId: string, sessionId: string) => void;
  reopenHeaderTab: () => void;
  moveHeaderTab: (projectId: string, sessionId: string, targetId: string, edge?: "before" | "after") => void;
  switchProject: (projectId: string) => Promise<void>;
  setNewSessionOpen: (open: boolean) => void;
  saveSettings: (settings: AppSettings) => Promise<void>;
  setSessionAgent: (agent: AgentProviderId) => Promise<void>;
  /** Changes the selected session's model, or `sessionId`'s (a side chat, which leaves the defaults alone). */
  setSessionModel: (provider: AgentProviderId, model: string | null, sessionId?: string) => Promise<void>;
  loadProviderModels: (id: AgentProviderId, force?: boolean) => Promise<void>;

  loadAllModels: (force?: boolean) => Promise<void>;
  toggleModelFavorite: (provider: AgentProviderId, modelId: string) => void;
}

let gitRequestSequence = 0;
let diffRequestSequence = 0;
let projectRequestSequence = 0;
let settingsSaveQueue: Promise<void> = Promise.resolve();
const pinQueues = new Map<string, Promise<boolean>>();
const browserBoundsSignatures = new Map<string, string>();
const pullRequestRequests = new Map<string, { promise: Promise<void>; workspacePath: string; branch: string | null }>();
const directAdmissions = new Map<string, { previousMessageId: string | null; prompt: string; clear: () => void }>();
const modelSelectionQueues = new Map<string, Promise<void>>();
let modelSelectionSequence = 0;
const modelRequests = new Map<AgentProviderId, Promise<void>>();
const usageRequests = new Map<AgentProviderId, { path: string | undefined; promise: Promise<void> }>();
let resetRequest: Promise<import("@/client/types").CodexResetResult> | null = null;
const draftWriter = createDraftWriter((key, value) => client.saveComposerDraft(key, value), (error) => useAppStore.setState({ error: formatUnknownError(error) }));
const contextWriter = createDraftWriter(async (key, edit: { value: string; flush: boolean }) => {
  const state = useAppStore.getState();
  if (!hasContextOwner(key, state.projects, state.sessions)) return;
  useAppStore.setState(current => ({ contextTextStatus: { ...current.contextTextStatus, [key]: { saving: true, error: null } } }));
  await client.saveContextText(key, edit.value, edit.flush);
}, (error, key) => {
  const state = useAppStore.getState();
  if (hasContextOwner(key, state.projects, state.sessions)) useAppStore.setState(current => ({ contextTextStatus: { ...current.contextTextStatus, [key]: { saving: false, error: formatUnknownError(error) } } }));
}, (previous, next) => ({ ...next, flush: previous.flush || next.flush }));
async function writeContextText(key: string, value: string, flush: boolean) {
  await contextWriter.write(key, { value, flush });
  const state = useAppStore.getState();
  if (hasContextOwner(key, state.projects, state.sessions) && (state.contextTexts[key] ?? "") === value && !state.contextTextStatus[key]?.error) {
    useAppStore.setState(current => ({ contextTextStatus: { ...current.contextTextStatus, [key]: { saving: false, error: null } } }));
  }
}
function persistDraftChanges(before: Record<string, string>, after: Record<string, string>) {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] !== after[key]) void draftWriter.write(key, after[key] ?? "");
  }
}

/** Minimum chat width kept while the dock grows, like Synara's composer probe. */
const MIN_CHAT_WIDTH = 440;

function clampDockWidth(width: number, state: Pick<AppStore, "sidebarCollapsed" | "sidebarWidth">): number {
  const viewport = typeof window === "undefined" ? 1440 : window.innerWidth;
  const sidebar = state.sidebarCollapsed ? SIDEBAR_RAIL_WIDTH : state.sidebarWidth;
  const max = Math.max(320, viewport - sidebar - MIN_CHAT_WIDTH);
  return Math.min(max, Math.max(280, width));
}

let navApplying = false;
let previousStatuses = new Map<string, Session["status"]>();
let previousSessionIds = new Set<string>();
let lastNavKey: string | null = null;

function navKeyOf(fields: NavEntry): string {
  return `${fields.mainView}\0${fields.projectId ?? ""}\0${fields.sessionId ?? ""}\0${fields.settingsPage?.section ?? ""}`;
}

function currentNavEntry(state: AppStore): NavEntry {
  return { mainView: state.mainView, projectId: state.selectedProjectId, sessionId: state.selectedSessionId,
    settingsPage: state.settingsOpen ? { section: state.settingsSection } : null };
}

/** Applies a history entry only while its project/session still exist. */
function resolveNavEntry(entry: NavEntry, state: AppStore) {
  const selectedProjectId = entry.projectId && state.projects.some((project) => project.id === entry.projectId) ? entry.projectId : null;
  const session = selectedProjectId && entry.sessionId
    ? state.sessions.find((item) => item.id === entry.sessionId && item.projectId === selectedProjectId)?.id ?? null
    : null;
  const selectedSessionId = selectedProjectId && entry.sessionId && !session
    ? state.sessions.find((item) => item.projectId === selectedProjectId)?.id ?? null
    : session;
  return { mainView: entry.mainView, selectedProjectId, selectedSessionId,
    settingsOpen: !!entry.settingsPage, settingsSection: entry.settingsPage?.section ?? state.settingsSection };
}

function recordNavigation() {
  const state = useAppStore.getState();
  const key = navKeyOf(currentNavEntry(state));
  const current = state.navHistory[state.navIndex];
  if (current && navKeyOf(current) === key) return;
  const entry = currentNavEntry(state);
  const navHistory = [...state.navHistory.slice(0, state.navIndex + 1), entry].slice(-MAX_NAV_ENTRIES);
  useAppStore.setState({ navHistory, navIndex: navHistory.length - 1 });
}

export const useAppStore = create<AppStore>((set, get) => ({
  providerAccounts: [], selectedProviderAccounts: {},
  addProviderAccount: async (provider, name) => {
    const account = await client.createProviderAccount(provider, name);
    set((state) => ({ providerAccounts: [...state.providerAccounts, account] }));
    return account;
  },
  selectProviderAccount: async (provider, id) => {
    await client.selectProviderAccount(provider, id);
    set((state) => ({ selectedProviderAccounts: { ...state.selectedProviderAccounts, [provider]: id } }));
    await get().refreshProviderUsage(provider, true);
  },
  renameProviderAccount: async (provider, id, name) => {
    const account = await client.renameProviderAccount(provider, id, name);
    set((state) => ({ providerAccounts: state.providerAccounts.map((current) => current.id === id ? account : current) }));
  },
  usageByProvider: {},
  usageLoading: {},
  providerUpdates: null,
  updatesChecking: false,
  updatesApplying: false,
  updateError: null,
  refreshProjectGit: async (projectId) => {
    const project = get().projects.find((item) => item.id === projectId);
    if (!project) return;
    try {
      const identity = await client.gitIdentity(project.path);
      set((state) => ({ gitByPath: { ...state.gitByPath, [project.path]: identity } }));
    } catch (error) {
      set({ error: formatUnknownError(error) });
    }
  },
  importSessions: (imported) => {
    if (!imported.length) return;
    set((state) => ({
      sessions: [...imported, ...state.sessions],
      loadedTranscripts: { ...state.loadedTranscripts, ...Object.fromEntries(imported.map((session) => [session.id, ++transcriptTick])) },
      selectedProjectId: imported[0].projectId,
      selectedSessionId: imported[0].id,
      mainView: "session",
      error: null,
    }));
    void get().refreshGitStatus();
  },
  checkProviderUpdates: async (force = false) => {
    if (!get().settings.enableProviderUpdateChecks) {
      set({ providerUpdates: [] });
      return;
    }
    if (get().updatesChecking) return;
    set({ updatesChecking: true });
    try {
      const updates = await client.providerUpdates(force);
      set({ providerUpdates: updates });
    } catch {
      set({ providerUpdates: [] });
    } finally {
      set({ updatesChecking: false });
    }
  },
  applyProviderUpdates: async () => {
    const outdated = (get().providerUpdates ?? []).filter((update) => update.updateAvailable && update.updateSupported);
    if (!outdated.length || get().updatesApplying) return;
    set({ updatesApplying: true, updateError: null, error: null });
    try {
      const results = await client.updateProviders(outdated.map((update) => update.provider));
      await get().refreshAgents();
      await get().checkProviderUpdates(true);
      // Surface failures last: agent refresh clears the shared error slot.
      const failures = results.filter((result) => !result.ok);
      if (failures.length) {
        const message = failures.map((failure) => `${providerById(failure.provider).name}: ${failure.message || "Update command failed."}`).join(" · ");
        set({ updateError: message, error: message });
      }
    } catch (error) {
      const message = formatUnknownError(error);
      set({ updateError: message, error: message });
    } finally {
      set({ updatesApplying: false });
    }
  },
  refreshProviderUsage: (provider, force = false) => {
    const accountId = activeProviderAccount(provider, selectCurrentSession(get()), get().selectedProviderAccounts);
    const stamp = () => `${get().settings.providerPaths[provider] ?? ""}::${activeProviderAccount(provider, selectCurrentSession(get()), get().selectedProviderAccounts)}`;
    const paths = stamp();
    const existing = usageRequests.get(provider);
    if (existing) return existing.path === paths ? existing.promise : existing.promise.then(() => get().refreshProviderUsage(provider, force));
    const request = (async () => {
      if (provider === "codex" && resetRequest) await resetRequest.catch(() => undefined);
      set((state) => ({ usageLoading: { ...state.usageLoading, [provider]: true }, usageByProvider: (state.usageByProvider[provider]?.providerAccountId ?? "default") === accountId ? state.usageByProvider : { ...state.usageByProvider, [provider]: undefined } }));
      try {
        const usage = await client.providerUsage(provider, force, accountId);
        if (stamp() === paths) set((state) => ({ usageByProvider: { ...state.usageByProvider, [provider]: usage } }));
      } catch {
        if (stamp() === paths) set((state) => ({ usageByProvider: { ...state.usageByProvider, [provider]: { provider, providerAccountId: accountId, status: "error", windows: [], updatedAt: Date.now(), note: "Could not read usage. Check the existing CLI login and version, then refresh.", resetCount: 0, resetOffer: null, account: null } } }));
      } finally {
        set((state) => ({ usageLoading: { ...state.usageLoading, [provider]: false } }));
      }
    })().finally(() => usageRequests.delete(provider));
    usageRequests.set(provider, { path: paths, promise: request });
    return request;
  },
  consumeCodexReset: (offer) => {
    if (resetRequest) return Promise.reject(new Error("A Codex reset is already in progress."));
    const stamp = () => `${get().settings.providerPaths.codex ?? ""}::${activeProviderAccount("codex", selectCurrentSession(get()), get().selectedProviderAccounts)}`;
    const paths = stamp();
    const request = (async () => {
      await usageRequests.get("codex")?.promise;
      set((state) => ({
        usageLoading: { ...state.usageLoading, codex: true },
        usageByProvider: state.usageByProvider.codex ? { ...state.usageByProvider, codex: { ...state.usageByProvider.codex, resetOffer: null } } : state.usageByProvider,
      }));
      try {
        const result = await client.consumeCodexReset(offer);
        if (stamp() === paths) set((state) => ({ usageByProvider: { ...state.usageByProvider, codex: result.usage } }));
        return result;
      } finally {
        set((state) => ({ usageLoading: { ...state.usageLoading, codex: false } }));
      }
    })().finally(() => { resetRequest = null; });
    resetRequest = request;
    return request;
  },
  ready: false,
  activityNotifications: [],
  error: null,
  projects: [],
  sessions: [],
  settings: defaultSettings,
  hostInfo: null,
  agents: [],
  modelsByProvider: {},
  modelChangesPending: {},
  selectedProjectId: null,
  selectedSessionId: null,
  mainView: "session",
  messageJump: null,
  transcriptSearch: null,
  openTranscriptSearch: (scope = "session") => set(state => ({ dockMaximized: false, transcriptSearch: { query: state.transcriptSearch?.query ?? "", scope: state.selectedSessionId ? scope : "all", revision: (state.transcriptSearch?.revision ?? 0) + 1 } })),
  updateTranscriptSearch: (change) => set(state => ({ transcriptSearch: state.transcriptSearch ? { ...state.transcriptSearch, ...change, query: (change.query ?? state.transcriptSearch.query).slice(0, 256) } : null })),
  closeTranscriptSearch: () => set({ transcriptSearch: null }),
  addReviewComment: (sessionId, messageId, selection) => {
    const state = get();
    const session = state.sessions.find(item => item.id === sessionId);
    const message = session?.messages.find(item => item.id === messageId && item.sessionId === sessionId);
    const review = message?.activity?.review;
    const file = review?.files.find(item => item.path === selection.path);
    if (!session || !state.projects.some(project => project.id === session.projectId) || state.selectedSessionId !== sessionId || state.selectedProjectId !== session.projectId || state.mainView !== "session" || state.settingsOpen || state.paletteOpen || state.newSessionOpen || message?.role !== "agent" || message.streaming || message.activity?.endedAt == null || review?.expired || !file || file.binary || file.diff == null || file.diff !== selection.diff) return false;
    const owner = `session:${sessionId}`;
    const next = appendDiffComment(state.composerDrafts[owner] ?? "", selection.path, file.diff, selection.from, selection.to, selection.comment);
    if (next === null) return false;
    state.setComposerDraft(owner, next);
    set({ dockMaximized: false });
    return true;
  },
  setMainView: (mainView) => set({ mainView }),
  sidebarWidth: SIDEBAR_MIN_WIDTH,
  sidebarCollapsed: false,
  draftIsolated: false,
  draftTemporary: false,
  setDraftTemporary: (draftTemporary) => set({ draftTemporary }),
  temporarySessionIds: [],
  composerDrafts: {},
  contextTexts: {},
  contextTextStatus: {},
  setContextText: async (key, value) => {
    if (!hasContextOwner(key, get().projects, get().sessions)) return;
    if (value.length > CONTEXT_TEXT_LIMIT) {
      set(state => ({ contextTextStatus: { ...state.contextTextStatus, [key]: { saving: false, error: "Notes exceed the 16,384 character limit" } } }));
      return;
    }
    set(state => {
      const contextTexts = { ...state.contextTexts };
      if (value) contextTexts[key] = value; else delete contextTexts[key];
      return { contextTexts, contextTextStatus: { ...state.contextTextStatus, [key]: { saving: true, error: null } } };
    });
    await writeContextText(key, value, false);
  },
  flushContextText: async key => {
    if (hasContextOwner(key, get().projects, get().sessions)) await writeContextText(key, get().contextTexts[key] ?? "", true);
  },
  composerContexts: {},
  promptQueues: {},
  pausePromptQueue: (sessionId) => {
    const queue = get().promptQueues[sessionId];
    const session = get().sessions.find(session => session.id === sessionId);
    if (queue || session) set((state) => ({ promptQueues: { ...state.promptQueues, [sessionId]: { ...(queue ?? { items: [], waitingFor: session ? lastAssistantId(session) : null }), paused: true, reason: "queue.manual" } } }));
  },
  resumePromptQueue: (sessionId) => {
    const queue = get().promptQueues[sessionId];
    const session = get().sessions.find(item => item.id === sessionId);
    if (!queue || !session || queue.inFlight || !queue.items.length) return;
    if (get().modelChangesPending[sessionId] || !queue.items.every(item => sameQueueBinding(session, item))) {
      set((state) => ({ promptQueues: { ...state.promptQueues, [sessionId]: { ...queue, paused: true, reason: "queue.contextChanged" } } }));
      return;
    }
    set((state) => ({ promptQueues: { ...state.promptQueues, [sessionId]: { ...queue, paused: false, reason: undefined, waitingFor: activeSession(session) ? lastAssistantId(session) : queue.waitingFor !== lastAssistantId(session) ? queue.waitingFor : null } } }));
    void advancePromptQueue(sessionId);
  },
  editQueuedPrompt: (sessionId, id, text) => {
    const queue = get().promptQueues[sessionId];
    const item = queue?.items.find(item => item.id === id);
    if (!item || queue.inFlight === id || item.afterMessageId !== undefined || !get().sessions.some(session => session.id === sessionId)) return false;
    const prompt = composerPrompt(text, item.context);
    if (!validQueuedPrompt(prompt)) return false;
    set((state) => ({ promptQueues: { ...state.promptQueues, [sessionId]: { ...queue, items: queue.items.map(item => item.id === id ? { ...item, text, prompt } : item) } } }));
    return true;
  },
  cancelQueuedPrompt: (sessionId, id) => {
    const queue = get().promptQueues[sessionId];
    const item = queue?.items.find(item => item.id === id);
    if (!item || queue.inFlight === id) return;
    set((state) => ({ promptQueues: { ...state.promptQueues, [sessionId]: { ...queue, items: queue.items.filter(item => item.id !== id) } } }));
    releaseUnusedQueueAttachments(item.context.attachments, `session:${sessionId}`);
  },
  setComposerContext: (key, context) => {
    const owner = key.startsWith("session:") ? get().sessions.some((session) => `session:${session.id}` === key) : get().projects.some((project) => `project:${project.id}` === key);
    if (owner) {
      const removed = (get().composerContexts[key]?.attachments ?? []).filter((file) => !context.attachments.some((next) => next.id === file.id));
      const releases = new Map<string, string[]>();
      for (const file of removed) {
        const shared = Object.entries(get().composerContexts).some(([other, draft]) => other !== key && draft.attachments.some((reference) => reference.id === file.id));
        const queued = Object.values(get().promptQueues).some(queue => queue.items.some(item => item.context.attachments.some(reference => reference.id === file.id)));
        if (!shared && !queued) {
          const nativeOwner = file.owner ?? key;
          releases.set(nativeOwner, [...(releases.get(nativeOwner) ?? []), file.id]);
        }
      }
      for (const [nativeOwner, ids] of releases) void client.releasePromptAttachments(nativeOwner, ids).catch(() => {});
      set((state) => ({ composerContexts: { ...state.composerContexts, [key]: context },
        dockPanes: state.dockPanes.filter((pane) => !pane.document || !(releases.get(pane.document.owner) ?? []).includes(pane.document.attachmentId)) }));
    }
  },
  setComposerDraft: (key, value) => {
    const before = get().composerDrafts;
    set((state) => {
    const composerDrafts = { ...state.composerDrafts };
    if (value) composerDrafts[key] = value; else delete composerDrafts[key];
    return { composerDrafts };
    });
    persistDraftChanges(before, get().composerDrafts);
  },
  dockWidth: 480,
  dockOpen: false,
  dockMaximized: false,
  dockPanes: [],
  dockActivePaneId: null,
  terminalWorkspacesBySession: {},
  localServersBySession: {},
  selectedFileBySession: {},
  browserBySession: {},
  windowSnapNotice: null,
  splitLayout: initialSplit(),
  splitDrag: null,
  setSplitDrag: (splitDrag) => set({ splitDrag }),
  dropOnSplit: (sessionId, drop) => {
    const state = get();
    const next = splitDrop(state.splitLayout, sessionId, drop);
    if (next === state.splitLayout) return;
    set({ splitLayout: next });
    get().activateSplitPane(next.activeLeafId);
  },
  openInSplit: (sessionId, edge) => {
    const layout = get().splitLayout;
    const from = leafShowing(layout, sessionId);
    // A conversation shown in the active pane moves beside the pane that was open before it.
    const target = from?.id === layout.activeLeafId ? splitLeaves(layout.root).find((leaf) => leaf.id !== from.id)?.id : layout.activeLeafId;
    if (target) get().dropOnSplit(sessionId, { target, edge });
  },
  activateSplitPane: (leafId) => {
    const state = get();
    const leaf = splitLeaves(state.splitLayout.root).find((item) => item.id === leafId);
    if (!leaf) return;
    if (state.splitLayout.activeLeafId !== leafId) set({ splitLayout: { ...state.splitLayout, activeLeafId: leafId } });
    if (leaf.sessionId) { if (state.selectedSessionId !== leaf.sessionId || state.mainView !== "session") void get().selectSession(leaf.sessionId); }
    else if (state.selectedSessionId) get().requestNewSession();
  },
  closeSplitPane: (leafId) => {
    const state = get();
    const next = splitRemove(state.splitLayout, leafId);
    if (next === state.splitLayout) return;
    set({ splitLayout: next });
    if (next.activeLeafId !== state.splitLayout.activeLeafId) get().activateSplitPane(next.activeLeafId);
  },
  resizeSplit: (branchId, ratio) => set((state) => ({ splitLayout: splitResize(state.splitLayout, branchId, ratio) })),
  openTabsByProject: {},
  lastActiveTabByProject: {},
  closedTabs: [],
  draftTabByProject: {},
  closeDraftTab: (projectId) => {
    const state = get();
    const tabs = visibleTabSessions(state.openTabsByProject[projectId] ?? [], state.sessions, projectId, state.settings.archivedSessionIds).map(session => session.id);
    const onDraft = state.mainView === "session" && !state.selectedSessionId && state.selectedProjectId === projectId;
    // The blank tab is the landing itself; it can only go away when another tab can take focus.
    const fallback = state.lastActiveTabByProject[projectId] && tabs.includes(state.lastActiveTabByProject[projectId]) ? state.lastActiveTabByProject[projectId] : tabs.at(-1);
    if (onDraft && !fallback) return;
    // Select the fallback in the same update, or the subscription would recreate the blank tab.
    set({ draftTabByProject: { ...state.draftTabByProject, [projectId]: false }, ...(onDraft && fallback ? { selectedSessionId: fallback } : {}) });
    if (onDraft && fallback) void get().selectSession(fallback);
  },
  unseenSessionIds: [],
  githubInbox: {},
  automations: null,
  tasks: null,
  loadedTranscripts: {},
  ensureTranscript: (sessionId, refresh = false) => {
    if (!refresh && get().loadedTranscripts[sessionId] !== undefined) {
      useAppStore.setState((state) => ({ loadedTranscripts: { ...state.loadedTranscripts, [sessionId]: ++transcriptTick } }));
      return Promise.resolve(true);
    }
    const pending = transcriptRequests.get(sessionId);
    if (pending) return pending;
    const request = client.loadTranscript(sessionId).then((messages) => {
      useAppStore.setState((state) => {
        if (!state.sessions.some((session) => session.id === sessionId)) return {};
        return {
          sessions: state.sessions.map((session) => session.id === sessionId ? { ...session, messages: mergeLoadedTranscript(session.messages, messages) } : session),
          loadedTranscripts: { ...state.loadedTranscripts, [sessionId]: ++transcriptTick },
        };
      });
      releaseTranscripts();
      return true;
    }, () => false).finally(() => transcriptRequests.delete(sessionId));
    transcriptRequests.set(sessionId, request);
    return request;
  },
  projectSwitcherOpen: false,
  setProjectSwitcherOpen: (open) => set({ projectSwitcherOpen: open }),
  closeHeaderTab: (projectId, sessionId) => {
    const state = get();
    const result = closeTabRule(state.openTabsByProject[projectId] ?? [], sessionId);
    if (result.index < 0) return;
    const wasActive = state.mainView === "session" && state.selectedSessionId === sessionId;
    // Move the selection in the same update, or the tab-opening subscription would reopen the closed tab.
    set({
      openTabsByProject: { ...state.openTabsByProject, [projectId]: result.tabs },
      closedTabs: [...state.closedTabs, { projectId, sessionId, index: result.index }].slice(-20),
      ...(wasActive ? { selectedSessionId: result.neighbor } : {}),
    });
    if (wasActive) {
      if (result.neighbor) void get().selectSession(result.neighbor);
      else get().requestNewSession();
    }
  },
  closeOtherHeaderTabs: (projectId, sessionId) => {
    const state = get();
    const tabs = state.openTabsByProject[projectId] ?? [];
    set({
      openTabsByProject: { ...state.openTabsByProject, [projectId]: tabs.filter(id => id === sessionId) },
      closedTabs: [...state.closedTabs, ...tabs.flatMap((id, index) => id === sessionId ? [] : [{ projectId, sessionId: id, index }])].slice(-20),
      selectedSessionId: sessionId,
    });
    if (state.selectedSessionId !== sessionId) void get().selectSession(sessionId);
  },
  closeHeaderTabsToRight: (projectId, sessionId) => {
    const state = get();
    const tabs = state.openTabsByProject[projectId] ?? [];
    const cut = tabs.indexOf(sessionId) + 1;
    if (cut <= 0) return;
    set({
      openTabsByProject: { ...state.openTabsByProject, [projectId]: tabs.slice(0, cut) },
      closedTabs: [...state.closedTabs, ...tabs.slice(cut).map((id, offset) => ({ projectId, sessionId: id, index: cut + offset }))].slice(-20),
      ...(state.selectedSessionId && tabs.slice(cut).includes(state.selectedSessionId) ? { selectedSessionId: sessionId } : {}),
    });
    if (state.selectedSessionId && tabs.slice(cut).includes(state.selectedSessionId)) void get().selectSession(sessionId);
  },
  reopenHeaderTab: () => {
    const state = get();
    const closed = [...state.closedTabs];
    let entry = closed.pop();
    while (entry && !state.sessions.some(session => session.id === entry!.sessionId)) entry = closed.pop();
    set({ closedTabs: closed });
    if (!entry) return;
    const tabs = (state.openTabsByProject[entry.projectId] ?? []).filter(id => id !== entry!.sessionId);
    tabs.splice(Math.min(entry.index, tabs.length), 0, entry.sessionId);
    set({ openTabsByProject: { ...get().openTabsByProject, [entry.projectId]: tabs } });
    void get().selectSession(entry.sessionId);
  },
  moveHeaderTab: (projectId, sessionId, targetId, edge) => {
    const tabs = get().openTabsByProject[projectId] ?? [];
    set({ openTabsByProject: { ...get().openTabsByProject, [projectId]: moveTabRule(tabs, sessionId, targetId, edge) } });
  },
  switchProject: async (projectId) => {
    set({ projectSwitcherOpen: false });
    const before = get();
    const archived = new Set(before.settings.archivedSessionIds);
    const alive = (id: string | undefined) => !!id && before.sessions.some(session => session.id === id && session.projectId === projectId && !archived.has(id));
    const remembered = before.lastActiveTabByProject[projectId];
    const target = alive(remembered) ? remembered : (before.openTabsByProject[projectId] ?? []).find(alive);
    await get().selectProject(projectId);
    // Returning to a project restores its last active tab; a project without tabs keeps selectProject's choice.
    if (target) await get().selectSession(target);
  },
  computer: null,
  computerAction: async (action) => {
    try {
      set({ computer: await client.computerAction(action) });
      return true;
    } catch (error) {
      set({ error: formatUnknownError(error) });
      return false;
    }
  },
  browserHistoryBySession: {},
  editorBuffers: {},
  editorSaving: {},
  editors: null,
  editorIcons: {},
  remoteUrlByProject: {},
  environmentOpen: false,
  navHistory: [],
  navIndex: -1,
  setEnvironmentOpen: (open) => set({ environmentOpen: open }),
  toggleEnvironment: () => {
    const environmentOpen = !get().environmentOpen;
    set({ environmentOpen });
    // The header toggle is the manual preference: actions and Escape only close.
    if (get().settings.environmentPanelDefaultOpen !== environmentOpen) {
      void get().saveSettings({ ...get().settings, environmentPanelDefaultOpen: environmentOpen });
    }
  },
  goBack: () => {
    const state = get();
    if (state.navIndex <= 0) return;
    const entry = state.navHistory[state.navIndex - 1];
    navApplying = true;
    set({ ...resolveNavEntry(entry, state), navIndex: state.navIndex - 1, gitStatus: null, selectedDiff: null, diffText: null });
    navApplying = false;
    void get().refreshGitStatus();
  },
  goForward: () => {
    const state = get();
    if (state.navIndex >= state.navHistory.length - 1) return;
    const entry = state.navHistory[state.navIndex + 1];
    navApplying = true;
    set({ ...resolveNavEntry(entry, state), navIndex: state.navIndex + 1, gitStatus: null, selectedDiff: null, diffText: null });
    navApplying = false;
    void get().refreshGitStatus();
  },
  paletteOpen: false,
  settingsOpen: false,
  settingsSection: "general",
  newSessionOpen: false,
  gitByPath: {},
  gitStatus: null,
  selectedDiff: null,
  diffText: null,

  bootstrap: async () => {
    try {
      // CLI version probes and other projects' Git identities fill in after the first paint.
      const detection = client.detectAgents().then((agents) => ({ agents }), (error: unknown) => ({ error }));
      const [data, hostInfo] = await Promise.all([client.loadState(), client.hostInfo().catch(() => null)]);
      const projects = [...data.projects].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
      const settings = mergeSettings(data.settings);
      const selectedProjectId = settings.openLastProject ? (projects[0]?.id ?? null) : null;
      const sessions = data.sessions;
      const selectedSessionId =
        settings.restorePreviousSessions && selectedProjectId
          ? (sessions.find((session) => session.projectId === selectedProjectId && !session.sideChat && !settings.archivedSessionIds.includes(session.id))?.id ?? null)
          : null;
      // Only the selected transcript loads before the first paint (ADR-048).
      const initialTranscript = selectedSessionId ? await client.loadTranscript(selectedSessionId).catch(() => null) : null;
      const identify = async (project: Project) => {
        try { return [project.path, await client.gitIdentity(project.path)] as const; }
        catch (error) { set({ error: formatUnknownError(error) }); return null; }
      };
      const selectedProject = projects.find((project) => project.id === selectedProjectId);
      const identities = selectedProject ? [await identify(selectedProject)] : [];
      set({
        ready: true,
        hostInfo,
        projects,
        sessions: initialTranscript ? sessions.map((session) => session.id === selectedSessionId ? { ...session, messages: initialTranscript } : session) : sessions,
        loadedTranscripts: initialTranscript && selectedSessionId ? { [selectedSessionId]: ++transcriptTick } : {},
        settings,
        selectedProjectId,
        selectedSessionId,
        gitByPath: Object.fromEntries(identities.filter((item) => item !== null)),
        sidebarCollapsed: settings.sidebarCollapsed,
        environmentOpen: settings.environmentPanelDefaultOpen,
        composerDrafts: data.composerDrafts ?? {},
        contextTexts: normalizeContextTexts(data.contextTexts, projects, sessions),
        contextTextStatus: {},
        pullRequestsBySession: {},
        browserBySession: {},
        browserHistoryBySession: {},
        providerAccounts: data.providerAccounts ?? [],
        selectedProviderAccounts: data.selectedProviderAccounts ?? {},
      });
      void detection.then((result) => set("agents" in result ? { agents: result.agents } : { error: formatUnknownError(result.error) }));
      void Promise.all(projects.filter((project) => project !== selectedProject).map(identify)).then((rest) => set((state) => ({
        gitByPath: { ...Object.fromEntries(rest.filter((item) => item !== null)), ...state.gitByPath },
      })));
      if (settings.enableProviderUpdateChecks) void get().checkProviderUpdates();
      if (selectedSessionId) {
        await get().refreshGitStatus();
      }
    } catch (error) {
      set({
        ready: true,
        error: formatUnknownError(error),
      });
    }
  },

  refreshAgents: async () => {
    try {
      const agents = await client.detectAgents();
      set({ agents, error: null });
    } catch (error) {
      set({ error: formatUnknownError(error) });
    }
  },

  addProjectFromPicker: async () => {
    const path = await client.pickFolder();
    if (!path) return;
    const project = await client.addProject(path);
    const identity = await client.gitIdentity(project.path);
    set((state) => ({
      projects: state.projects.some((item) => item.id === project.id) ? state.projects.map((item) => item.id === project.id ? project : item) : [project, ...state.projects],
      selectedProjectId: project.id,
      selectedSessionId: state.sessions.find((session) => session.projectId === project.id && !session.sideChat && !state.settings.archivedSessionIds.includes(session.id))?.id ?? null,
      gitStatus: null, selectedDiff: null, diffText: null,
      gitByPath: { ...state.gitByPath, [project.path]: identity },
    }));
  },

  selectProject: async (projectId) => {
    const sequence = ++projectRequestSequence;
    const project = await client.openProject(projectId);
    if (sequence !== projectRequestSequence) return;
    const sessions = get().sessions.filter((session) => session.projectId === projectId && !session.sideChat && !get().settings.archivedSessionIds.includes(session.id));
    set({
      selectedProjectId: projectId,
      selectedSessionId: sessions[0]?.id ?? null,
      gitStatus: null,
      selectedDiff: null,
      diffText: null,
      projects: get().projects.map((item) => item.id === projectId ? project : item),
    });
    if (sessions[0]) await get().refreshGitStatus();
  },

  removeProject: async (projectId) => {
    await client.removeProject(projectId);
    const projects = get().projects.filter((project) => project.id !== projectId);
    const removedSessionIds = new Set(get().sessions.filter((session) => session.projectId === projectId).map((session) => session.id));
    const removedSessions = new Set([...removedSessionIds].map((id) => `session:${id}`));
    for (const key of [`project:${projectId}`, ...removedSessions]) draftWriter.forget(key);
    for (const key of [`project:${projectId}`, ...removedSessions]) contextWriter.forget(key);
    const composerDrafts = Object.fromEntries(Object.entries(get().composerDrafts).filter(([key]) => key !== `project:${projectId}` && !removedSessions.has(key)));
    const sessions = get().sessions.filter((session) => session.projectId !== projectId);
    const nextProject = get().selectedProjectId === projectId ? projects[0]?.id ?? null : get().selectedProjectId;
    const terminalWorkspacesBySession = Object.fromEntries(Object.entries(get().terminalWorkspacesBySession).filter(([key]) => !removedSessionIds.has(key)));
    const localServersBySession = Object.fromEntries(Object.entries(get().localServersBySession).filter(([key]) => !removedSessionIds.has(key)));
    const selectedFileBySession = Object.fromEntries(Object.entries(get().selectedFileBySession).filter(([key]) => !removedSessionIds.has(key)));
    const dockPanes = get().dockPanes.filter((pane) => !((pane.kind === "editor" || pane.kind === "review") && pane.sessionId && removedSessionIds.has(pane.sessionId)) && (!pane.document || (![pane.document.owner, pane.document.scope].some((key) => key === `project:${projectId}` || removedSessions.has(key)))));
    const dockActivePaneId = dockPanes.some((pane) => pane.id === get().dockActivePaneId) ? get().dockActivePaneId : (dockPanes[dockPanes.length - 1]?.id ?? null);
    const editorBuffers = Object.fromEntries(Object.entries(get().editorBuffers).filter(([key]) => ![...removedSessionIds].some((id) => key.startsWith(`${id}:`))));
    for (const sessionId of removedSessionIds) {
      browserBoundsSignatures.delete(sessionId);
      void client.browserClose(sessionId).catch(() => undefined);
    }
    set({
      projects,
      sessions,
      settings: pruneSidebarSettings(get().settings, projects, sessions),
      composerDrafts,
      promptQueues: Object.fromEntries(Object.entries(get().promptQueues).filter(([id]) => !removedSessionIds.has(id))),
      unseenSessionIds: get().unseenSessionIds.filter((id) => !removedSessionIds.has(id)),
      loadedTranscripts: Object.fromEntries(Object.entries(get().loadedTranscripts).filter(([id]) => !removedSessionIds.has(id))),
      contextTexts: normalizeContextTexts(get().contextTexts, projects, sessions),
      pullRequestsBySession: Object.fromEntries(Object.entries(get().pullRequestsBySession).filter(([id]) => !removedSessionIds.has(id))),
      browserBySession: Object.fromEntries(Object.entries(get().browserBySession).filter(([id]) => !removedSessionIds.has(id))),
      browserHistoryBySession: Object.fromEntries(Object.entries(get().browserHistoryBySession).filter(([id]) => !removedSessionIds.has(id))),
      contextTextStatus: Object.fromEntries(Object.entries(get().contextTextStatus).filter(([key]) => key !== `project:${projectId}` && !removedSessions.has(key))),
      composerContexts: Object.fromEntries(Object.entries(get().composerContexts).filter(([key]) => key !== `project:${projectId}` && !removedSessions.has(key))),
      selectedProjectId: nextProject,
      selectedSessionId: sessions.find((session) => session.id === get().selectedSessionId)?.id ?? sessions.find((session) => session.projectId === nextProject && !session.sideChat && !get().settings.archivedSessionIds.includes(session.id))?.id ?? null,
      terminalWorkspacesBySession,
      localServersBySession,
      selectedFileBySession,
      dockPanes,
      dockActivePaneId,
      editorBuffers,
      gitStatus: null, selectedDiff: null, diffText: null,
    });
    await get().refreshGitStatus();
  },

  updateProjectLook: async (action) => {
    try {
      const updated = await client.projectLookAction(action);
      if (updated) set((state) => ({ error: null, projects: state.projects.map((project) => project.id === updated.id ? { ...project, look: updated.look } : project) }));
      return Boolean(updated);
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },
  renameProject: async (projectId, name) => {
    try {
      const updated = await client.renameProject(projectId, name.trim());
      set((state) => ({ projects: state.projects.map((project) => project.id === projectId ? { ...project, name: updated.name } : project) }));
      return true;
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },

  createSession: async (agent, isolatedWorktree, title, model) => {
    const projectId = get().selectedProjectId;
    if (!projectId) return;
    try {
      const session = await client.createSession({
        projectId,
        agent,
        isolatedWorktree,
        title,
        model: model ?? null,
      });
      set((state) => ({
        sessions: [session, ...state.sessions],
        loadedTranscripts: { ...state.loadedTranscripts, [session.id]: ++transcriptTick },
        ...(state.selectedProjectId === projectId ? { selectedSessionId: session.id, mainView: "session" as const } : {}),
        newSessionOpen: false,
        error: null,
      }));
      await get().refreshGitStatus();
    } catch (error) {
      set({ error: formatUnknownError(error) });
    }
  },

  selectSession: async (sessionId) => {
    ++projectRequestSequence;
    const session = get().sessions.find((item) => item.id === sessionId);
    if (!session) return;
    // A side chat lives beside its main session (notifications can name it).
    if (session.sideChat) {
      await get().selectSession(session.sideChat.parentSessionId);
      void get().openSideChat(session.sideChat.parentSessionId);
      return;
    }
    set({ mainView: "session", selectedSessionId: sessionId, selectedProjectId: session.projectId, gitStatus: null, selectedDiff: null, diffText: null });
    await get().refreshGitStatus();
  },

  jumpToMessage: async (sessionId, messageId, searchStart) => {
    // Search results can point into a transcript that is not loaded yet.
    if (!(await get().ensureTranscript(sessionId))) return;
    const session = get().sessions.find((item) => item.id === sessionId);
    if (!session?.messages.some((message) => message.id === messageId)) return;
    const changed = get().selectedSessionId !== sessionId;
    set((state) => ({ mainView: "session", selectedSessionId: sessionId, selectedProjectId: session.projectId,
      messageJump: { sessionId, messageId, searchStart, sequence: (state.messageJump?.sequence ?? 0) + 1 },
      ...(changed ? { gitStatus: null, selectedDiff: null, diffText: null } : {}),
    }));
    if (changed) void get().refreshGitStatus();
  },

  forkSession: async (sessionId, messageId) => {
    try {
      const fork = await client.forkSession(sessionId, messageId);
      set((state) => ({ sessions: [fork, ...state.sessions], loadedTranscripts: { ...state.loadedTranscripts, [fork.id]: ++transcriptTick }, error: null,
        ...(state.selectedSessionId === sessionId ? { selectedSessionId: fork.id, selectedProjectId: fork.projectId,
          mainView: "session" as const, gitStatus: null, selectedDiff: null, diffText: null } : {}),
      }));
      await get().refreshGitStatus();
      return true;
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },

  handoffSession: async (sessionId, messageId, agent, model) => {
    try {
      const handoff = await client.handoffSession(sessionId, messageId, agent, model);
      set((state) => ({ sessions: [handoff, ...state.sessions], loadedTranscripts: { ...state.loadedTranscripts, [handoff.id]: ++transcriptTick }, error: null,
        selectedSessionId: handoff.id, selectedProjectId: handoff.projectId,
        mainView: "session" as const, gitStatus: null, selectedDiff: null, diffText: null,
      }));
      await get().refreshGitStatus();
      return true;
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },

  secondOpinion: async (sessionId, messageId, agent, model) => {
    if (!(await get().ensureTranscript(sessionId))) return false;
    const source = get().sessions.find((session) => session.id === sessionId);
    if (!source) return false;
    const portuguese = get().settings.locale !== "en";
    const prompt = secondOpinionPrompt(secondOpinionTurn(source, messageId), providerById(source.agent).name, portuguese);
    try {
      // Handoff provides the same-workspace session; its recap is dropped for the review prompt.
      const created = await client.handoffSession(sessionId, messageId, agent, model);
      const dismissed = await client.dismissHandoff(created.id);
      const titled = await client.renameSession(created.id, `${portuguese ? "Segunda opinião" : "Second opinion"} · ${source.title}`.slice(0, 200));
      set((state) => ({ error: null, sessions: [{ ...created, handoff: dismissed.handoff, title: titled.title, lastActivityAt: titled.lastActivityAt }, ...state.sessions],
        loadedTranscripts: { ...state.loadedTranscripts, [created.id]: ++transcriptTick } }));
      if (get().selectedSessionId !== sessionId) await get().selectSession(sessionId);
      const before = get().splitLayout;
      get().openInSplit(created.id, "right");
      if (get().splitLayout === before) await get().selectSession(created.id);
      return await get().sendPrompt(prompt, supportsPlanning(agent, model) ? { planning: true } : undefined, created.id);
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },

  dismissHandoff: async (sessionId) => {
    try {
      const updated = await client.dismissHandoff(sessionId);
      set((state) => ({ error: null, sessions: state.sessions.map((session) => session.id === sessionId
        ? { ...session, handoff: updated.handoff } : session) }));
      return true;
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },

  loadBrowser: async (sessionId) => {
    try {
      const browser = await client.browserState(sessionId);
      set((state) => ({ error: null, browserBySession: { ...state.browserBySession, [browser.sessionId]: browser } }));
    } catch (error) { set({ error: formatUnknownError(error) }); }
  },

  openBrowser: async (sessionId) => {
    try {
      const browser = await client.browserOpen(sessionId);
      set((state) => ({ error: null, browserBySession: { ...state.browserBySession, [browser.sessionId]: browser } }));
      return true;
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },

  closeBrowser: async (sessionId) => {
    try {
      await client.browserClose(sessionId);
      browserBoundsSignatures.delete(sessionId);
      set((state) => {
        const browserBySession = { ...state.browserBySession };
        delete browserBySession[sessionId];
        return { error: null, browserBySession };
      });
      return true;
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },

  browserNewTab: async (sessionId, url = null) => {
    try {
      const browser = await client.browserNewTab(sessionId, url ?? null);
      set((state) => ({ error: null, browserBySession: { ...state.browserBySession, [browser.sessionId]: browser } }));
      return true;
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },

  browserCloseTab: async (sessionId, tabId) => {
    try {
      const browser = await client.browserCloseTab(sessionId, tabId);
      set((state) => ({ error: null, browserBySession: { ...state.browserBySession, [browser.sessionId]: browser } }));
      return true;
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },

  browserSelectTab: async (sessionId, tabId) => {
    try {
      const browser = await client.browserSelectTab(sessionId, tabId);
      set((state) => ({ error: null, browserBySession: { ...state.browserBySession, [browser.sessionId]: browser } }));
      return true;
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },

  browserNavigate: async (sessionId, tabId, url) => {
    try {
      const browser = await client.browserNavigate(sessionId, tabId, url);
      set((state) => ({ error: null, browserBySession: { ...state.browserBySession, [browser.sessionId]: browser } }));
      return true;
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },

  browserReload: async (sessionId, tabId) => {
    try {
      const browser = await client.browserReload(sessionId, tabId);
      set((state) => ({ error: null, browserBySession: { ...state.browserBySession, [browser.sessionId]: browser } }));
      return true;
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },

  browserBack: async (sessionId, tabId) => {
    try {
      const browser = await client.browserBack(sessionId, tabId);
      set((state) => ({ error: null, browserBySession: { ...state.browserBySession, [browser.sessionId]: browser } }));
      return true;
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },

  browserForward: async (sessionId, tabId) => {
    try {
      const browser = await client.browserForward(sessionId, tabId);
      set((state) => ({ error: null, browserBySession: { ...state.browserBySession, [browser.sessionId]: browser } }));
      return true;
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },

  setBrowserBounds: (sessionId, bounds) => {
    const signature = bounds
      ? `${Math.round(bounds.x)}:${Math.round(bounds.y)}:${Math.round(bounds.width)}:${Math.round(bounds.height)}`
      : "hidden";
    if (browserBoundsSignatures.get(sessionId) === signature) return;
    browserBoundsSignatures.set(sessionId, signature);
    void client.browserSetBounds(sessionId, bounds).catch(() => undefined);
  },

  browserAnnotateStart: async (sessionId, tabId) => {
    try {
      await client.browserAnnotateStart(sessionId, tabId);
      set({ error: null });
      return true;
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },

  browserAnnotateFinish: async (sessionId, tabId) => {
    try {
      return await client.browserAnnotateFinish(sessionId, tabId);
    } catch (error) { set({ error: formatUnknownError(error) }); return null; }
  },

  browserAnnotateCancel: async (sessionId, tabId) => {
    try { await client.browserAnnotateCancel(sessionId, tabId); } catch { /* overlay already gone */ }
  },

  browserCopyLink: async (sessionId, tabId) => {
    try {
      await client.browserCopyLink(sessionId, tabId);
      set({ error: null });
      return true;
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },

  browserCapture: async (sessionId, tabId) => {
    try {
      return await client.browserCapture(sessionId, tabId);
    } catch (error) { set({ error: formatUnknownError(error) }); return null; }
  },


  noteBrowserUrl: (sessionId, url) => {
    if (!/^https?:\/\//i.test(url)) return;
    set((state) => {
      const current = state.browserHistoryBySession[sessionId] ?? [];
      if (current[0] === url) return state;
      const next = [url, ...current.filter((entry) => entry !== url)].slice(0, 50);
      return { browserHistoryBySession: { ...state.browserHistoryBySession, [sessionId]: next } };
    });
  },

  setMessagePinned: (sessionId, messageId, pinned) => {
    // Serialize metadata acknowledgments without replacing newer native output.
    const request = (pinQueues.get(sessionId) ?? Promise.resolve(true)).then(async () => {
      try {
        const pinnedMessageIds = await client.setMessagePinned(sessionId, messageId, pinned);
        set((state) => ({ sessions: state.sessions.map((session) => session.id === sessionId ? { ...session, pinnedMessageIds } : session), error: null }));
        return true;
      } catch (error) { set({ error: formatUnknownError(error) }); return false; }
    }).finally(() => { if (pinQueues.get(sessionId) === request) pinQueues.delete(sessionId); });
    pinQueues.set(sessionId, request);
    return request;
  },

  sendPrompt: async (prompt, execution, targetSessionId) => {
    const selectedId = targetSessionId ?? get().selectedSessionId;
    const originKey = selectedId ? `session:${selectedId}` : `project:${get().selectedProjectId}`;
    const submittedDraft = get().composerDrafts[originKey];
    const originalContext = get().composerContexts[originKey];
    const restoredContext = composerContextForOwner(originKey, get().composerContexts, get().sessions);
    let submittedContext = originalContext;
    const initialSessionId = selectedId;
    const initialSession = get().sessions.find(session => session.id === initialSessionId);
    const initialBinding = initialSession ? queueBinding(initialSession) : null;
    const initialMessageId = initialSession ? lastAssistantId(initialSession) : null;
    const initialQueue = initialSessionId ? get().promptQueues[initialSessionId] : undefined;
    const intendedQueue = Boolean(initialSession && activeSession(initialSession) || initialQueue?.items.length);
    const capturedAttachment = await captureBrowserAttachment(prompt, initialSessionId);
    if (capturedAttachment) {
      try {
        submittedContext = { ...restoredContext, attachments: appendAttachments(restoredContext.attachments, [capturedAttachment]) };
      } catch (error) {
        void client.releasePromptAttachments(originKey, [capturedAttachment.id]).catch(() => undefined);
        set({ error: formatUnknownError(error) });
        return false;
      }
    }
    try {
      if (initialSessionId) {
        const session = get().sessions.find(item => item.id === initialSessionId);
        const queue = get().promptQueues[initialSessionId];
        if (!session) return false;
        if (!initialBinding || !sameQueueBinding(session, { binding: initialBinding }) || get().modelChangesPending[initialSessionId]) {
          if (capturedAttachment) releaseUnusedQueueAttachments([capturedAttachment], originKey);
          set({ error: "queue.contextChanged" });
          return false;
        }
        if (intendedQueue || activeSession(session) || queue?.items.length) {
          if (!validQueuedPrompt(prompt) || (queue?.items.length ?? 0) >= PROMPT_QUEUE_LIMIT || get().modelChangesPending[initialSessionId]) {
            if (capturedAttachment) releaseUnusedQueueAttachments([capturedAttachment], originKey);
            set({ error: "queue.limit" });
            return false;
          }
          const context = submittedContext ?? restoredContext;
          const item = { id: newId(), text: submittedDraft ?? (context.attachments.length ? "" : prompt), prompt, context: { ...context, attachments: [...context.attachments] }, execution: execution ? { ...execution } : undefined, binding: initialBinding };
          const before = get().composerDrafts;
          const paused = queue?.paused || initialQueue?.paused || intendedQueue && (session.status === "failed" || session.status === "stopped");
          const base = queue ?? { paused: Boolean(paused), reason: paused ? "queue.failed" : undefined, waitingFor: activeSession(session) ? lastAssistantId(session) : null };
          set((state) => ({ promptQueues: { ...state.promptQueues, [initialSessionId]: { ...base, paused: Boolean(paused), items: [...(queue?.items ?? []), item] } } }));
          // Move references into the queue before clearing the draft. They retain
          // their native owner and must not be released by chip removal.
          if (get().composerDrafts[originKey] === submittedDraft) get().setComposerDraft(originKey, "");
          if (get().composerContexts[originKey] === originalContext) get().setComposerContext(originKey, { ...context, attachments: [] });
          persistDraftChanges(before, get().composerDrafts);
          set({ error: null });
          void advancePromptQueue(initialSessionId);
          return true;
        }
      }
      let sessionId = initialSessionId;
      if (!sessionId) {
        const projectId = get().selectedProjectId;
        if (!projectId) return false;
        const { settings, draftIsolated, draftTemporary } = get();
        const parsed = parseModelKey(settings.defaultModel);
        const session = await client.createSession({ projectId, agent: settings.defaultAgent,
          isolatedWorktree: draftIsolated,
          model: parsed?.provider === settings.defaultAgent ? parsed.id : null });
        sessionId = session.id;
        const before = get().composerDrafts;
        set((state) => {
          const composerDrafts = { ...state.composerDrafts };
          const stayingOnOrigin = state.selectedProjectId === projectId && !state.selectedSessionId;
          const draft = stayingOnOrigin ? composerDrafts[originKey] : submittedDraft;
          if (draft) composerDrafts[`session:${session.id}`] = draft;
          if (stayingOnOrigin) delete composerDrafts[originKey];
          const composerContexts = { ...state.composerContexts };
          const transferredContext = stayingOnOrigin ? composerContexts[originKey] : submittedContext;
          // Team mode is one-shot: the plan request does not carry it into the new session.
          if (transferredContext) composerContexts[`session:${session.id}`] = transferredContext.team ? { ...transferredContext, team: false } : transferredContext;
          if (stayingOnOrigin) delete composerContexts[originKey];
          return { ...(draftTemporary ? { temporarySessionIds: [...state.temporarySessionIds, session.id], draftTemporary: false } : {}), sessions: [session, ...state.sessions], loadedTranscripts: { ...state.loadedTranscripts, [session.id]: ++transcriptTick }, composerDrafts, composerContexts,
            dockPanes: state.dockPanes.map((pane) => stayingOnOrigin && pane.document?.scope === originKey ? { ...pane, document: { ...pane.document, scope: `session:${session.id}` } } : pane),
            ...(stayingOnOrigin ? { selectedSessionId: session.id } : {}) };
        });
        persistDraftChanges(before, get().composerDrafts);
      }
      if (!sessionId) return false;
      const ownedSessionId = sessionId;
      if (!get().promptQueues[ownedSessionId]?.items.length && !get().promptQueues[ownedSessionId]?.inFlight) {
        set(state => { const promptQueues = { ...state.promptQueues }; delete promptQueues[ownedSessionId]; return { promptQueues }; });
      }
      let cleared = false;
      const previousGoal = get().sessions.find(session => session.id === ownedSessionId)?.goal;
      const admission = {
        previousMessageId: lastAssistantId(get().sessions.find(session => session.id === ownedSessionId)!),
        prompt,
        clear: () => {
          if (cleared) return;
          cleared = true;
          const before = get().composerDrafts;
          set((state) => {
            const composerDrafts = { ...state.composerDrafts };
            for (const key of [originKey, `session:${sessionId}`]) {
              if (composerDrafts[key] === submittedDraft) delete composerDrafts[key];
            }
            const composerContexts = { ...state.composerContexts };
            for (const key of [originKey, `session:${sessionId}`]) if (composerContexts[key] === submittedContext ||
              (capturedAttachment && originalContext !== undefined && composerContexts[key] === originalContext)) {
              if (submittedContext) composerContexts[key] = { ...submittedContext, attachments: [] };
              else delete composerContexts[key];
            }
            return { composerDrafts, composerContexts };
          });
          persistDraftChanges(before, get().composerDrafts);
        },
      };
      directAdmissions.set(ownedSessionId, admission);
      let response: Session;
      try {
        response = await client.sendPrompt({ sessionId, prompt, execution, team: Boolean(submittedContext?.team) || undefined, debugging: Boolean(submittedContext?.debugging) && !submittedContext?.planning && !submittedContext?.team, goal: submittedContext?.goal, attachmentIds: submittedContext?.attachments.map((file) => file.id) ?? [], attachmentOwner: originKey, queuedAfter: initialBinding ? { ...initialBinding, messageId: initialMessageId } : undefined });
      } finally {
        if (directAdmissions.get(ownedSessionId) === admission) directAdmissions.delete(ownedSessionId);
      }
      admission.clear();
      set(state => ({ error: null, sessions: state.sessions.map(session => session.id === ownedSessionId && (session.goal === previousGoal || lastAssistantId(session) === lastAssistantId(response)) ? { ...session, goal: response.goal ?? null } : session) }));
      return true;
    } catch (error) {
      set({ error: formatUnknownError(error) });
      return false;
    }
  },

  renameSession: async (sessionId, title) => {
    try {
      const updated = await client.renameSession(sessionId, title.trim());
      set((state) => ({ sessions: state.sessions.map((session) => session.id === sessionId ? { ...session, title: updated.title, lastActivityAt: updated.lastActivityAt } : session) }));
      return true;
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },
  deleteSession: async (sessionId, removeWorktree) => {
    try {
      await client.deleteSession(sessionId, removeWorktree, true);
      draftWriter.forget(`session:${sessionId}`);
      contextWriter.forget(`session:${sessionId}`);
      browserBoundsSignatures.delete(sessionId);
      void client.browserClose(sessionId).catch(() => undefined);
      set((state) => {
        // Native deletes the parent's side chats with it (ADR-049).
        const sideChats = new Set(state.sessions.filter((session) => session.sideChat?.parentSessionId === sessionId).map((session) => session.id));
        const sessions = state.sessions.filter((session) => session.id !== sessionId && !sideChats.has(session.id));
        const composerDrafts = { ...state.composerDrafts };
        delete composerDrafts[`session:${sessionId}`];
        const composerContexts = { ...state.composerContexts }; delete composerContexts[`session:${sessionId}`];
        const contextTexts = { ...state.contextTexts }; delete contextTexts[`session:${sessionId}`];
        const contextTextStatus = { ...state.contextTextStatus }; delete contextTextStatus[`session:${sessionId}`];
        const terminalWorkspacesBySession = { ...state.terminalWorkspacesBySession }; delete terminalWorkspacesBySession[sessionId];
        const localServersBySession = { ...state.localServersBySession }; delete localServersBySession[sessionId];
        const selectedFileBySession = { ...state.selectedFileBySession }; delete selectedFileBySession[sessionId];
        const sideParent = state.sessions.find((session) => session.id === sessionId)?.sideChat?.parentSessionId;
        const dockPanes = state.dockPanes.filter((pane) => !((pane.kind === "editor" || pane.kind === "review" || pane.kind === "sidechat") && pane.sessionId === sessionId) &&
          !(pane.kind === "sidechat" && pane.sessionId === sideParent) && (!pane.document || (pane.document.scope !== `session:${sessionId}` && pane.document.owner !== `session:${sessionId}`)));
        const dockActivePaneId = dockPanes.some((pane) => pane.id === state.dockActivePaneId) ? state.dockActivePaneId : (dockPanes[dockPanes.length - 1]?.id ?? null);
        const editorBuffers = Object.fromEntries(Object.entries(state.editorBuffers).filter(([key]) => !key.startsWith(`${sessionId}:`)));
        const pullRequestsBySession = { ...state.pullRequestsBySession }; delete pullRequestsBySession[sessionId];
        const browserBySession = { ...state.browserBySession }; delete browserBySession[sessionId];
        const browserHistoryBySession = { ...state.browserHistoryBySession }; delete browserHistoryBySession[sessionId];
        const promptQueues = { ...state.promptQueues }; delete promptQueues[sessionId];
        const loadedTranscripts = { ...state.loadedTranscripts }; delete loadedTranscripts[sessionId];
        return { sessions, promptQueues, loadedTranscripts, unseenSessionIds: state.unseenSessionIds.filter((id) => id !== sessionId), settings: pruneSidebarSettings(state.settings, state.projects, sessions), composerDrafts, composerContexts, contextTexts, contextTextStatus, pullRequestsBySession, browserBySession, browserHistoryBySession, terminalWorkspacesBySession, localServersBySession, selectedFileBySession, dockPanes, dockActivePaneId, editorBuffers, ...(state.selectedSessionId === sessionId ? {
          selectedSessionId: sessions.find((session) => session.projectId === state.selectedProjectId && !session.sideChat && !state.settings.archivedSessionIds.includes(session.id))?.id ?? null,
          gitStatus: null, selectedDiff: null, diffText: null,
        } : {}) };
      });
      await get().refreshGitStatus();
      return true;
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },

  respondAgentRequest: async (request) => {
    try { await client.respondAgentRequest(request); set({ error: null }); return true; }
    catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },

  stopAgent: async (target) => {
    const sessionId = target ?? get().selectedSessionId;
    if (!sessionId) return;
    get().pausePromptQueue(sessionId);
    try { await client.stopAgent(sessionId); } catch (error) { set({ error: formatUnknownError(error) }); }
  },

  loadGithubInbox: async (kind, state) => {
    const key = `${kind}:${state}`;
    if (get().githubInbox[key]?.loading) return;
    set((current) => ({ githubInbox: { ...current.githubInbox, [key]: { data: current.githubInbox[key]?.data ?? null, loading: true, error: null } } }));
    try {
      const response = await client.pullRequestAction({ type: "list", kind, state });
      const data = response.type === "inbox" ? response : null;
      set((current) => ({ githubInbox: { ...current.githubInbox, [key]: { data, loading: false, error: null } } }));
    } catch (error) {
      set((current) => ({ githubInbox: { ...current.githubInbox, [key]: { data: current.githubInbox[key]?.data ?? null, loading: false, error: formatUnknownError(error) } } }));
    }
  },

  taskAction: async (action) => {
    try {
      const tasks = await client.taskAction(action);
      set({ tasks });
      return tasks;
    } catch (error) { set({ error: formatUnknownError(error) }); return null; }
  },

  automationAction: async (action) => {
    try {
      const snapshot = await client.automationAction(action);
      set({ automations: snapshot });
      return snapshot;
    } catch (error) { set({ error: formatUnknownError(error) }); return null; }
  },

  pullRequestAction: async (action) => {
    try { return await client.pullRequestAction(action); }
    catch (error) { set({ error: formatUnknownError(error) }); return null; }
  },

  openSideChat: async (parentSessionId, quote) => {
    try {
      const side = await client.sideChatAction({ type: "open", parentSessionId });
      showSideChat(parentSessionId, side, quote);
      return true;
    } catch (error) { set({ error: formatUnknownError(error) }); return false; }
  },

  toggleSideChat: () => {
    const state = get();
    const parent = state.selectedSessionId;
    if (!parent || state.mainView !== "session") return;
    const pane = state.dockPanes.find((item) => item.kind === "sidechat" && item.sessionId === parent);
    if (pane && state.dockOpen && state.dockActivePaneId === pane.id) {
      state.closeDockPane(pane.id);
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`textarea[data-draft-owner="session:${parent}"]`)?.focus());
      return;
    }
    void state.openSideChat(parent);
  },

  teamAction: async (action) => {
    try {
      const response = await client.teamAction(action);
      set((state) => {
        const removed = new Set(response.removed);
        const returned = new Map(response.sessions.map((session) => [session.id, session]));
        const known = new Set(state.sessions.map((session) => session.id));
        const kept = state.sessions.filter((session) => !removed.has(session.id)).map((session) => {
          const next = returned.get(session.id);
          return next ? { ...next, pinnedMessageIds: session.pinnedMessageIds ?? next.pinnedMessageIds } : session;
        });
        // Team actions return complete sessions.
        const loadedTranscripts = { ...state.loadedTranscripts };
        for (const session of response.sessions) loadedTranscripts[session.id] = ++transcriptTick;
        for (const id of removed) delete loadedTranscripts[id];
        return { error: null, sessions: [...response.sessions.filter((session) => !known.has(session.id)), ...kept], loadedTranscripts };
      });
      return true;
    } catch (error) {
      set({ error: formatUnknownError(error) });
      return false;
    }
  },

  refreshGitStatus: async () => {
    const sequence = ++gitRequestSequence;
    const sessionId = get().selectedSessionId;
    if (!sessionId) {
      set({ gitStatus: null });
      return;
    }
    try {
      const gitStatus = await client.gitStatus(sessionId);
      if (sequence === gitRequestSequence && get().selectedSessionId === sessionId) set({ gitStatus });
    } catch (error) {
      if (sequence === gitRequestSequence && get().selectedSessionId === sessionId) set({ gitStatus: null, error: formatUnknownError(error) });
    }
  },

  loadDiff: async (change) => {
    const sequence = ++diffRequestSequence;
    const sessionId = get().selectedSessionId;
    if (!sessionId) return;
    set({ selectedDiff: change, diffText: null });
    get().openDockPane("changes");
    try {
      const diffText = await client.gitDiff(sessionId, change.path);
      if (sequence === diffRequestSequence && get().selectedSessionId === sessionId && get().selectedDiff?.path === change.path) set({ diffText });
    } catch (error) { set({ error: formatUnknownError(error) }); }
  },

  setSidebarWidth: (width) => set({ sidebarWidth: Math.min(420, Math.max(SIDEBAR_MIN_WIDTH, width)) }),
  resizeSidebar: (delta) =>
    set((state) => ({ sidebarWidth: Math.min(420, Math.max(SIDEBAR_MIN_WIDTH, state.sidebarWidth + delta)) })),
  toggleSidebar: () => {
    const sidebarCollapsed = !get().sidebarCollapsed;
    set({ sidebarCollapsed });
    void get().saveSettings({ ...get().settings, sidebarCollapsed });
  },
  setDraftIsolated: (isolated) => set({ draftIsolated: isolated }),
  setDockWidth: (width) => set((state) => ({ dockWidth: clampDockWidth(width, state) })),
  toggleDock: () => set((state) => ({
    dockOpen: !state.dockOpen,
    dockMaximized: state.dockOpen ? false : state.dockMaximized,
    ...(state.dockOpen ? {} : { dockWidth: clampDockWidth(state.dockWidth, state) }),
  })),
  toggleDockMaximized: () => set((state) => ({ dockMaximized: !state.dockMaximized, dockOpen: true })),
  keepTurnChanges: async (sessionId, messageId) => {
    const review = await client.keepTurnChanges(sessionId, messageId);
    set((state) => ({ sessions: state.sessions.map((session) => session.id === sessionId ? {
      ...session, messages: session.messages.map((message) => message.id === messageId && message.activity?.review ? {
        ...message, activity: { ...message.activity, review: { ...message.activity.review, keptAt: review.keptAt } },
      } : message),
    } : session) }));
  },
  openTurnReview: (sessionId, messageId, path) => {
    set((state) => {
      const session = state.sessions.find((item) => item.id === sessionId);
      const review = session?.messages.find((m) => m.id === messageId && m.sessionId === sessionId && !m.streaming && m.activity?.endedAt != null)?.activity?.review;
      if (state.selectedSessionId !== sessionId || !review || (path && !review.files.some((f) => f.path === path))) return state;
      const existing = state.dockPanes.find((pane) => pane.kind === "review" && pane.sessionId === sessionId && pane.review?.messageId === messageId);
      const pane: DockPane = { ...(existing ?? { id: newId(), kind: "review" as const, sessionId }), review: { messageId, path: path ?? review.files[0]?.path } };
      const panes = existing ? state.dockPanes.map((item) => item.id === pane.id ? pane : item) : [...state.dockPanes, pane];
      const reviews = panes.filter((item) => item.kind === "review");
      return { dockPanes: reviews.length > 8 ? panes.filter((item) => item !== reviews[0]) : panes,
        dockActivePaneId: pane.id, dockOpen: true, dockWidth: clampDockWidth(state.dockWidth, state) };
    });
  },
  openAttachmentReader: (scope, attachment) => {
    const state = get();
    if (!hasContextOwner(scope, state.projects, state.sessions) || !canReadDocument(attachment)
      || !state.composerContexts[scope]?.attachments.some((file) => file.id === attachment.id)) return;
    const owner = attachment.owner ?? scope;
    set((current) => {
      const existing = current.dockPanes.find((pane) => pane.document?.scope === scope && pane.document.attachmentId === attachment.id);
      const pane: DockPane = existing ?? { id: newId(), kind: "document", document: { owner, scope, attachmentId: attachment.id, name: attachment.name } };
      const panes = existing ? current.dockPanes : [...current.dockPanes, pane];
      const documents = panes.filter((item) => item.kind === "document");
      return { dockPanes: documents.length > 8 ? panes.filter((item) => item !== documents[0]) : panes,
        dockActivePaneId: pane.id, dockOpen: true, dockWidth: clampDockWidth(current.dockWidth, current) };
    });
  },
  openDockPane: (kind, path) => {
    if (kind === "document" || kind === "review") return;
    if (kind === "sidechat") {
      const parent = get().selectedSessionId;
      if (parent) void get().openSideChat(parent);
      return;
    }
    const sessionId = get().selectedSessionId ?? undefined;
    let created: string | null = null;
    set((state) => {
      const existing =
        kind === "editor"
          ? state.dockPanes.find((pane) => pane.kind === "editor" && pane.path === path && pane.sessionId === sessionId)
          : state.dockPanes.find((pane) => pane.kind === kind);
      if (existing) return { dockOpen: true, dockActivePaneId: existing.id, dockWidth: clampDockWidth(state.dockWidth, state) };
      created = newId();
      const pane: DockPane = { id: created, kind, path, sessionId };
      const panes = [...state.dockPanes, pane];
      // Editor panes are per file; keep the working set bounded.
      const editors = panes.filter((item) => item.kind === "editor");
      const bounded = editors.length > 8 ? panes.filter((item) => item !== editors[0]) : panes;
      return { dockPanes: bounded, dockOpen: true, dockActivePaneId: created, dockWidth: clampDockWidth(state.dockWidth, state) };
    });
    if (kind === "terminal" && sessionId) get().ensureTerminal(sessionId);
  },
  closeDockPane: (paneId) =>
    set((state) => {
      const index = state.dockPanes.findIndex((pane) => pane.id === paneId);
      if (index === -1) return state;
      const dockPanes = state.dockPanes.filter((pane) => pane.id !== paneId);
      const active = state.dockActivePaneId === paneId
        ? (dockPanes[Math.min(index, dockPanes.length - 1)]?.id ?? null)
        : state.dockActivePaneId;
      return { dockPanes, dockActivePaneId: active };
    }),
  setActiveDockPane: (paneId) => set({ dockActivePaneId: paneId }),
  ensureTerminal: (sessionId) => {
    const workspace = get().terminalWorkspacesBySession[sessionId];
    if (workspace?.panes.length) return;
    set((state) => withWorkspace(state, sessionId, { split: "columns", panes: [newPane(nextTerminal(undefined))] }));
  },
  addTerminalTab: (sessionId, paneId) =>
    set((state) => {
      const workspace = state.terminalWorkspacesBySession[sessionId];
      if (!workspace) {
        return withWorkspace(state, sessionId, { split: "columns", panes: [newPane(nextTerminal(undefined))] });
      }
      if (terminalCount(workspace) >= MAX_TERMINALS_PER_SESSION) return state;
      if (!workspace.panes.some((pane) => pane.id === paneId)) return state;
      const terminal = nextTerminal(workspace);
      return withWorkspace(state, sessionId, {
        ...workspace,
        panes: workspace.panes.map((pane) => pane.id === paneId
          ? { ...pane, terminals: [...pane.terminals, terminal], activeTerminalId: terminal.id }
          : pane),
      });
    }),
  setActiveTerminal: (sessionId, paneId, terminalId) =>
    set((state) => {
      const workspace = state.terminalWorkspacesBySession[sessionId];
      const pane = workspace?.panes.find((item) => item.id === paneId);
      if (!workspace || !pane?.terminals.some((terminal) => terminal.id === terminalId)) return state;
      return withWorkspace(state, sessionId, {
        ...workspace,
        panes: workspace.panes.map((item) => item.id === paneId ? { ...item, activeTerminalId: terminalId } : item),
      });
    }),
  closeTerminal: (sessionId, terminalId) =>
    set((state) => {
      const workspace = state.terminalWorkspacesBySession[sessionId];
      const pane = workspace?.panes.find((item) => item.terminals.some((terminal) => terminal.id === terminalId));
      if (!workspace || !pane) return state;
      const terminals = pane.terminals.filter((terminal) => terminal.id !== terminalId);
      const panes = terminals.length === 0
        ? workspace.panes.filter((item) => item.id !== pane.id)
        : workspace.panes.map((item) => item.id === pane.id
          ? { ...item, terminals, activeTerminalId: item.activeTerminalId === terminalId ? terminals[terminals.length - 1].id : item.activeTerminalId }
          : item);
      if (panes.length === 0) {
        const terminalWorkspacesBySession = { ...state.terminalWorkspacesBySession };
        delete terminalWorkspacesBySession[sessionId];
        return { terminalWorkspacesBySession };
      }
      return withWorkspace(state, sessionId, { ...workspace, panes });
    }),
  splitTerminalPane: (sessionId, paneId, split) =>
    set((state) => {
      const workspace = state.terminalWorkspacesBySession[sessionId];
      if (!workspace || terminalCount(workspace) >= MAX_TERMINALS_PER_SESSION) return state;
      const index = workspace.panes.findIndex((pane) => pane.id === paneId);
      if (index === -1) return state;
      const panes = [
        ...workspace.panes.slice(0, index + 1),
        newPane(nextTerminal(workspace)),
        ...workspace.panes.slice(index + 1),
      ];
      return withWorkspace(state, sessionId, { split, panes });
    }),
  moveTerminalToOwnPane: (sessionId, paneId) =>
    set((state) => {
      const workspace = state.terminalWorkspacesBySession[sessionId];
      const pane = workspace?.panes.find((item) => item.id === paneId);
      if (!workspace || !pane || pane.terminals.length < 2) return state;
      const index = workspace.panes.findIndex((item) => item.id === paneId);
      const moved = pane.terminals.find((terminal) => terminal.id === pane.activeTerminalId) ?? pane.terminals[pane.terminals.length - 1];
      const remaining = pane.terminals.filter((terminal) => terminal.id !== moved.id);
      const panes = [
        ...workspace.panes.slice(0, index),
        { ...pane, terminals: remaining, activeTerminalId: remaining[remaining.length - 1].id },
        newPane(moved),
        ...workspace.panes.slice(index + 1),
      ];
      return withWorkspace(state, sessionId, { ...workspace, panes });
    }),
  noteLocalServers: (sessionId, urls) => {
    if (!urls.length) return;
    const current = get().localServersBySession[sessionId] ?? [];
    const merged = [...new Set([...current, ...urls])].slice(0, 8);
    if (merged.length === current.length) return;
    set((state) => ({ localServersBySession: { ...state.localServersBySession, [sessionId]: merged } }));
  },
  setSelectedFile: (sessionId, path) =>
    set((state) => ({ selectedFileBySession: { ...state.selectedFileBySession, [sessionId]: path } })),
  setEditorBuffer: (key, content, saved) =>
    set((state) => ({
      editorBuffers: { ...state.editorBuffers, [key]: { identity: state.editorBuffers[key]?.identity ?? newId(), content, saved: saved ?? state.editorBuffers[key]?.saved ?? content } },
    })),
  saveEditorBuffer: async (sessionId, path) => {
    const key = editorKey(sessionId, path);
    const pending = get().editorBuffers[key];
    if (get().editorSaving[key] || !pending || pending.content === pending.saved) return;
    // One shared gate survives file switches and multiple views of the same buffer.
    set(state => ({ editorSaving: { ...state.editorSaving, [key]: true } }));
    try {
      await client.writeTextFile(sessionId, path, pending.content);
      set(state => {
        const current = state.editorBuffers[key];
        if (!current || current.identity !== pending.identity) return state;
        return { editorBuffers: { ...state.editorBuffers, [key]: acknowledgeEditorSave(current, pending.content) } };
      });
    } finally {
      set(state => {
        const editorSaving = { ...state.editorSaving };
        delete editorSaving[key];
        return { editorSaving };
      });
    }
  },
  discardEditorBuffer: (key) =>
    set((state) => {
      if (!(key in state.editorBuffers) || state.editorSaving[key]) return state;
      const editorBuffers = { ...state.editorBuffers };
      delete editorBuffers[key];
      return { editorBuffers };
    }),
  loadEditors: async () => {
    if (get().editors) return;
    try {
      const editors = await client.detectEditors();
      set({ editors });
    } catch (error) {
      set({ error: formatUnknownError(error) });
      return;
    }
    try {
      const icons = await client.editorAppIcons();
      set({ editorIcons: Object.fromEntries(icons.filter((icon) => icon.png).map((icon) => [icon.id, icon.png])) });
    } catch {
      // Real app icons are decorative; the list keeps working without them.
    }
  },
  pullRequestsBySession: {},
  refreshPullRequest: async (sessionId, force = false) => {
    const session = get().sessions.find(row => row.id === sessionId);
    if (!session || !get().projects.some(project => project.id === session.projectId)) return;
    const workspacePath = session.worktree.path;
    const existing = get().pullRequestsBySession[sessionId];
    const actualBranch = get().selectedSessionId === sessionId ? get().gitStatus?.identity.branch : undefined;
    if (!force && existing?.workspacePath === workspacePath && existing.snapshot && !existing.error &&
      (!actualBranch || existing.snapshot.branch === actualBranch) && Date.now() - Date.parse(existing.snapshot.checkedAt) < 60_000) return;
    const requestBranch = actualBranch ?? session.worktree.branch;
    const pending = pullRequestRequests.get(sessionId);
    if (pending) {
      if (pending.workspacePath === workspacePath && pending.branch === requestBranch) return pending.promise;
      await pending.promise;
      return get().refreshPullRequest(sessionId, true);
    }
    const owns = () => get().sessions.some(row => row.id === sessionId && row.projectId === session.projectId && row.worktree.path === workspacePath && get().projects.some(project => project.id === row.projectId));
    set(state => ({ pullRequestsBySession: { ...state.pullRequestsBySession, [sessionId]: { workspacePath, loading: true, error: null, snapshot: null } } }));
    const request = (async () => {
      try {
        const snapshot = await client.sessionPullRequest(sessionId);
        if (!owns()) return;
        if (snapshot.sessionId !== sessionId) throw new Error("Could not load the pull request. Check GitHub CLI access and refresh.");
        // Native revalidation is newer than a possibly stale frontend Git snapshot.
        set(state => ({ pullRequestsBySession: { ...state.pullRequestsBySession, [sessionId]: { workspacePath, loading: false, error: null, snapshot } } }));
      } catch (error) {
        if (owns()) set(state => ({ pullRequestsBySession: { ...state.pullRequestsBySession, [sessionId]: { workspacePath, loading: false, error: formatUnknownError(error), snapshot: null } } }));
      }
    })().finally(() => { if (pullRequestRequests.get(sessionId)?.promise === request) pullRequestRequests.delete(sessionId); });
    pullRequestRequests.set(sessionId, { promise: request, workspacePath, branch: requestBranch });
    return request;
  },
  loadProjectRemote: async (projectId) => {
    if (projectId in get().remoteUrlByProject) return;
    try {
      const remoteUrl = await client.projectRemoteUrl(projectId);
      set((state) => ({ remoteUrlByProject: { ...state.remoteUrlByProject, [projectId]: remoteUrl } }));
    } catch (error) {
      set((state) => ({ remoteUrlByProject: { ...state.remoteUrlByProject, [projectId]: null } }));
      set({ error: formatUnknownError(error) });
    }
  },
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setSettingsOpen: (open) =>
    set({ settingsOpen: open }),
  setSettingsSection: (section) => set({ settingsSection: section }),
  requestNewSession: () => {
    get().setSettingsOpen(false);
    const { settings, selectedProjectId } = get();
    // A project needs to be chosen before there is a landing to compose in.
    if (!selectedProjectId) { set({ newSessionOpen: true }); return; }
    // New thread opens the empty landing; the session is created on first send.
    set({
      newSessionOpen: false,
      selectedSessionId: null,
      mainView: "session",
      draftIsolated: settings.defaultSessionWorkspace === "worktree",
      draftTemporary: false,
    });
  },
  setNewSessionOpen: (open) => set({ newSessionOpen: open }),
  saveSettings: async (settings) => {
    const previous = get().settings;
    const next = mergeSettings(settings);
    const pathsChanged = JSON.stringify(previous.providerPaths) !== JSON.stringify(next.providerPaths);
    set({ settings: next, activityNotifications: retainActivityNotifications(get().activityNotifications, next.notifications), ...(pathsChanged ? { modelsByProvider: {}, usageByProvider: {} } : {}) });
    const task = settingsSaveQueue.catch(() => undefined).then(async () => {
      try {
        const saved = await client.saveSettings(next);
        if (get().settings === next) set({ settings: mergeSettings(saved) });
        if (pathsChanged) await get().refreshAgents();
      } catch (error) {
        if (get().settings === next) set({ settings: previous });
        set({ error: formatUnknownError(error) });
      }
    });
    settingsSaveQueue = task;
    await task;
  },

  setSessionAgent: async (agent) => {
    await get().setSessionModel(agent, null);
  },

  setSessionModel: async (provider, model, target) => {
    const sequence = ++modelSelectionSequence;
    const sessionId = target ?? get().selectedSessionId;
    const defaultModel = model ? modelKey(provider, model) : null;
    if (!sessionId) {
      await get().saveSettings({ ...get().settings, defaultAgent: provider, defaultModel });
      return;
    }
    set((state) => ({ modelChangesPending: { ...state.modelChangesPending, [sessionId]: (state.modelChangesPending[sessionId] ?? 0) + 1 } }));
    const task = (modelSelectionQueues.get(sessionId) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      try {
        const session = await client.setSessionModel(sessionId, provider, model);
        set((state) => ({
          sessions: state.sessions.map((item) => item.id === session.id ? { ...item, agent: session.agent, model: session.model, providerAccountId: session.providerAccountId, accountBindings: session.accountBindings, forkOrigin: session.forkOrigin, nativeThread: session.nativeThread, pendingRequests: session.pendingRequests, lastActivityAt: session.lastActivityAt } : item),
        }));
        if (!target && sequence === modelSelectionSequence) await get().saveSettings({ ...get().settings, defaultAgent: provider, defaultModel });
      } catch (error) {
        set({ error: formatUnknownError(error) });
      } finally {
        set((state) => {
          const modelChangesPending = { ...state.modelChangesPending };
          if ((modelChangesPending[sessionId] ?? 0) <= 1) delete modelChangesPending[sessionId];
          else modelChangesPending[sessionId] -= 1;
          return { modelChangesPending };
        });
      }
    });
    modelSelectionQueues.set(sessionId, task);
    await task;
    if (modelSelectionQueues.get(sessionId) === task) modelSelectionQueues.delete(sessionId);
  },

  loadProviderModels: async (id, force = false) => {
    if (!force && get().modelsByProvider[id]) return;
    const pending = modelRequests.get(id);
    if (pending) { await pending; if (force) await get().loadProviderModels(id, true); return; }
    const paths = get().settings.providerPaths;
    const request = (async () => {
      try {
        const list = await client.listProviderModels(id);
        if (get().settings.providerPaths === paths) set((state) => ({ modelsByProvider: { ...state.modelsByProvider, [id]: list } }));
      } catch (error) { set({ error: formatUnknownError(error) }); }
    })();
    modelRequests.set(id, request);
    await request;
    if (modelRequests.get(id) === request) modelRequests.delete(id);
  },

  loadAllModels: async (force = false) => {
    await Promise.all(PROVIDERS.map((item) => get().loadProviderModels(item.id, force)));
  },

  toggleModelFavorite: (provider, modelId) => {
    const settings = get().settings;
    const key = modelKey(provider, modelId);
    const favoriteModels = settings.favoriteModels.includes(key)
      ? settings.favoriteModels.filter((item) => item !== key)
      : [...settings.favoriteModels, key];
    void get().saveSettings({ ...settings, favoriteModels });
  },

}));

// Header tabs: a project's tabs start as its sessions (sidebar order); any selection opens its tab;
// the landing shows a blank tab that the first send turns into the new session; finishing out of view marks it unseen.
useAppStore.subscribe((state) => {
  const finished = finishedUnseen(previousStatuses, state.sessions, state.mainView === "session" ? state.selectedSessionId : null);
  previousStatuses = new Map(state.sessions.map(session => [session.id, session.status]));
  const created = state.sessions.filter(session => !previousSessionIds.has(session.id)).map(session => session.id);
  const firstLoad = previousSessionIds.size === 0;
  previousSessionIds = new Set(state.sessions.map(session => session.id));
  const projectId = state.selectedProjectId;
  const known = !!projectId && state.projects.some(project => project.id === projectId);
  const selected = state.mainView === "session" ? state.sessions.find(session => session.id === state.selectedSessionId && session.projectId === projectId) : undefined;
  let tabs = state.openTabsByProject, drafts = state.draftTabByProject, active = state.lastActiveTabByProject;
  if (known && !tabs[projectId!]) {
    const groups = sidebarGroups(state.projects, state.sessions, state.settings);
    tabs = { ...tabs, [projectId!]: [...groups.pinned, ...groups.nested].filter(session => session.projectId === projectId).map(session => session.id).slice(0, TAB_LIMIT) };
  }
  if (selected) {
    const current = tabs[selected.projectId] ?? [];
    if (!current.includes(selected.id)) tabs = { ...tabs, [selected.projectId]: openTabRule(current, selected.id) };
    // A session born from the landing takes over the blank tab.
    if (drafts[selected.projectId] && !firstLoad && created.includes(selected.id)) drafts = { ...drafts, [selected.projectId]: false };
    if (active[selected.projectId] !== selected.id) active = { ...active, [selected.projectId]: selected.id };
  }
  if (known && state.mainView === "session" && !state.selectedSessionId && !drafts[projectId!]) drafts = { ...drafts, [projectId!]: true };
  const seen = !!selected && state.unseenSessionIds.includes(selected.id);
  if (tabs === state.openTabsByProject && drafts === state.draftTabByProject && active === state.lastActiveTabByProject && !finished.length && !seen) return;
  useAppStore.setState((current) => ({
    openTabsByProject: tabs,
    draftTabByProject: drafts,
    lastActiveTabByProject: active,
    unseenSessionIds: finished.length || seen ? [...new Set([...current.unseenSessionIds, ...finished])].filter(id => id !== selected?.id) : current.unseenSessionIds,
  }));
});

// Browser-style history: every selection change records one bounded entry.
useAppStore.subscribe((state) => {
  const key = navKeyOf(currentNavEntry(state));
  if (key === lastNavKey) return;
  lastNavKey = key;
  if (!navApplying) recordNavigation();
});

/** Prompt-triggered browser context: a screenshot of the active tab attaches to the turn. */
async function captureBrowserAttachment(prompt: string, sessionId: string | null) {
  if (!sessionId || !/(browser|navegador|p[áa]gina|page|screenshot|captura|print|veja (o|a) (site|p[áa]gina))/i.test(prompt)) return null;
  const browser = useAppStore.getState().browserBySession[sessionId];
  const active = browser?.tabs.find((tab) => tab.id === browser.activeTabId);
  if (!active?.url || !/^https?:\/\//i.test(active.url)) return null;
  try {
    const png = await client.browserCapture(sessionId, active.id);
    const [attachment] = await client.pastePromptAttachments(`session:${sessionId}`, [{ name: "browser.png", data: png }]);
    return attachment ?? null;
  } catch {
    return null;
  }
}

/**
 * Shows a side chat in the right dock beside its parent (ADR-049). Without a
 * remembered composer mode it starts read-only (planning) where supported.
 */
function showSideChat(parentSessionId: string, side: Session, quote?: string) {
  const owner = `session:${side.id}`;
  useAppStore.setState((state) => {
    const known = state.sessions.some((session) => session.id === side.id);
    // Composer modes are memory-only, so a side chat reopens read-only after a restart too.
    const composerContexts = !state.composerContexts[owner]
      ? { ...state.composerContexts, [owner]: { ...emptyComposerContext, planning: supportsPlanning(side.agent, side.model ?? null) } }
      : state.composerContexts;
    const existing = state.dockPanes.find((pane) => pane.kind === "sidechat" && pane.sessionId === parentSessionId);
    const pane: DockPane = existing ?? { id: newId(), kind: "sidechat", sessionId: parentSessionId };
    return { sessions: known ? state.sessions : [side, ...state.sessions], composerContexts,
      dockPanes: existing ? state.dockPanes : [...state.dockPanes, pane], dockOpen: true, dockActivePaneId: pane.id, dockWidth: clampDockWidth(state.dockWidth, state) };
  });
  const store = useAppStore.getState();
  if (quote) {
    const next = appendTranscriptQuote(store.composerDrafts[owner] ?? "", quote);
    if (next !== null) store.setComposerDraft(owner, next);
  }
  void store.ensureTranscript(side.id);
  requestAnimationFrame(() => {
    const area = document.querySelector<HTMLTextAreaElement>(`textarea[data-draft-owner="${owner}"]`);
    area?.focus({ preventScroll: true });
    area?.setSelectionRange(area.value.length, area.value.length);
  });
}

function releaseUnusedQueueAttachments(files: import("@/client/types").PromptAttachment[], owner: string) {
  const state = useAppStore.getState();
  for (const file of files) {
    const used = Object.values(state.composerContexts).some(context => context.attachments.some(reference => reference.id === file.id)) || Object.values(state.promptQueues).some(queue => queue.items.some(item => item.context.attachments.some(reference => reference.id === file.id)));
    if (!used) void client.releasePromptAttachments(file.owner ?? owner, [file.id]).catch(() => undefined);
  }
}

/** Only native lifecycle snapshots may release the next explicitly queued send. */
export function observePromptQueue(session: Session) {
  let queue = useAppStore.getState().promptQueues[session.id];
  if (!queue || !useAppStore.getState().sessions.some(item => item.id === session.id)) return;
  const messageId = lastAssistantId(session);
  const head = queue.items[0];
  // An IPC rejection can precede delivery of its native admission snapshot.
  // Reconcile that late snapshot without ever rebasing/replaying the request.
  if (!queue.inFlight && head && observedQueuedAdmission(session, head)) {
    queue = { ...queue, items: queue.items.slice(1), waitingFor: messageId };
    const reconciled = queue;
    useAppStore.setState(state => ({ promptQueues: { ...state.promptQueues, [session.id]: reconciled } }));
  }
  if (activeSession(session)) {
    if (messageId && messageId !== queue.waitingFor) useAppStore.setState(state => ({ promptQueues: { ...state.promptQueues, [session.id]: { ...queue, waitingFor: messageId } } }));
    return;
  }
  if (!queue.waitingFor || messageId !== queue.waitingFor || session.messages.find(message => message.id === messageId)?.streaming) return;
  const failed = session.status !== "completed";
  useAppStore.setState(state => ({ promptQueues: { ...state.promptQueues, [session.id]: { ...queue, waitingFor: null, paused: failed || queue.paused, reason: failed ? "queue.failed" : queue.reason } } }));
  void advancePromptQueue(session.id);
}

async function advancePromptQueue(sessionId: string) {
  const state = useAppStore.getState();
  const queue = state.promptQueues[sessionId];
  const session = state.sessions.find(item => item.id === sessionId);
  const item = queue?.items[0];
  if (!queue || !session || !item || queue.paused || queue.inFlight || queue.waitingFor || activeSession(session)) return;
  if (state.modelChangesPending[sessionId] || !sameQueueBinding(session, item)) {
    useAppStore.setState(state => ({ promptQueues: { ...state.promptQueues, [sessionId]: { ...queue, paused: true, reason: "queue.contextChanged" } } }));
    return;
  }
  // Claim synchronously before IPC: repeated final snapshots cannot double-send.
  const predecessor = item.afterMessageId === undefined ? lastAssistantId(session) : item.afterMessageId;
  if (lastAssistantId(session) !== predecessor) {
    useAppStore.setState(state => ({ promptQueues: { ...state.promptQueues, [sessionId]: { ...queue, paused: true, reason: "queue.contextChanged" } } }));
    return;
  }
  useAppStore.setState(state => ({ promptQueues: { ...state.promptQueues, [sessionId]: { ...queue, inFlight: item.id, items: queue.items.map(entry => entry.id === item.id ? { ...entry, afterMessageId: predecessor } : entry) } } }));
  let succeeded = false;
  let response: Session | undefined;
  try {
    response = await client.sendPrompt({ sessionId, prompt: item.prompt, execution: item.execution, debugging: Boolean(item.context.debugging) && !item.context.planning, goal: item.context.goal, attachmentIds: item.context.attachments.map(file => file.id), attachmentOwner: `session:${sessionId}`, queuedAfter: { ...item.binding, messageId: predecessor } });
    succeeded = true;
  } catch (error) {
    useAppStore.setState({ error: formatUnknownError(error) });
  }
  const latest = useAppStore.getState();
  const live = latest.sessions.find(session => session.id === sessionId);
  const current = latest.promptQueues[sessionId];
  if (!live || !current || current.inFlight !== item.id) return;
  // Startup/persistence may fail after admission. Never replay an admitted turn.
  const admitted = succeeded || observedQueuedAdmission(live, { ...item, afterMessageId: predecessor });
  const waitingFor = activeSession(live) ? lastAssistantId(live) : response && lastAssistantId(live) === predecessor ? lastAssistantId(response) : null;
  const effectiveStatus = response && lastAssistantId(live) === predecessor ? response.status : live.status;
  const failed = !succeeded || effectiveStatus === "failed" || effectiveStatus === "stopped";
  useAppStore.setState(state => ({ promptQueues: { ...state.promptQueues, [sessionId]: { ...current, items: admitted ? current.items.filter(entry => entry.id !== item.id) : current.items, inFlight: undefined, waitingFor, paused: current.paused || failed, reason: failed ? "queue.failed" : current.reason } }, sessions: state.sessions.map(session => session.id === sessionId && response ? { ...session, goal: response.goal ?? null } : session) }));
  if (admitted && !succeeded) releaseUnusedQueueAttachments(item.context.attachments, `session:${sessionId}`);
  // A very fast turn may have settled while send_prompt was still returning.
  if (!waitingFor && live.status === "completed") void advancePromptQueue(sessionId);
}

let transcriptTick = 0;
const transcriptRequests = new Map<string, Promise<boolean>>();
/** Views that need a transcript while mounted (team helpers, historical reviews). */
const retainedTranscripts = new Map<string, number>();

/** Keeps a session's transcript loaded until the returned release is called. */
export function retainTranscript(sessionId: string) {
  retainedTranscripts.set(sessionId, (retainedTranscripts.get(sessionId) ?? 0) + 1);
  void useAppStore.getState().ensureTranscript(sessionId);
  return () => {
    const count = (retainedTranscripts.get(sessionId) ?? 1) - 1;
    if (count > 0) retainedTranscripts.set(sessionId, count); else retainedTranscripts.delete(sessionId);
    releaseTranscripts();
  };
}

/** Drops transcripts outside the keep set; their metadata stays. */
function releaseTranscripts() {
  useAppStore.setState((state) => {
    const keep = transcriptsToKeep({
      loaded: state.loadedTranscripts, sessions: state.sessions, selectedSessionId: state.selectedSessionId,
      queued: Object.entries(state.promptQueues).filter(([, queue]) => queue.items.length).map(([id]) => id),
      retained: retainedTranscripts.keys(),
    });
    const release = Object.keys(state.loadedTranscripts).filter((id) => !keep.has(id));
    if (!release.length) return {};
    const released = new Set(release);
    return {
      loadedTranscripts: Object.fromEntries(Object.entries(state.loadedTranscripts).filter(([id]) => !released.has(id))),
      sessions: state.sessions.map((session) => released.has(session.id)
        ? { ...session, messages: [], transcriptLength: session.messages.filter((message) => message.role !== "system").length }
        : session),
    };
  });
}

/**
 * Streamed deltas arrive once per provider token. Applying them once per frame
 * keeps the store, and every subscriber, to at most one update per frame while
 * output keeps the exact native order and offsets.
 */
const outputBatch = (() => {
  let pending: AgentEvent[] = [];
  let cancelScheduled: (() => void) | null = null;
  const flush = () => {
    cancelScheduled?.();
    cancelScheduled = null;
    if (!pending.length) return;
    const events = pending;
    pending = [];
    const bySession = new Map<string, AgentEvent[]>();
    for (const event of events) bySession.set(event.sessionId, [...(bySession.get(event.sessionId) ?? []), event]);
    const gaps = new Set<string>();
    useAppStore.setState((state) => ({
      sessions: state.sessions.map((session) => {
        const queued = bySession.get(session.id);
        // An unloaded transcript is fetched whole when opened; partial text is never kept.
        if (!queued || state.loadedTranscripts[session.id] === undefined) return session;
        let messages = session.messages;
        for (const event of queued) {
          // A transcript loaded mid-stream can miss text emitted before it arrived.
          const target = messages.find((message) => message.id === event.messageId);
          if (!event.message && (!target || target.content.length < event.offset)) gaps.add(session.id);
          messages = applyAgentOutput(messages, event);
        }
        return messages === session.messages ? session : { ...session, messages };
      }),
    }));
    for (const id of gaps) void useAppStore.getState().ensureTranscript(id, true);
  };
  const schedule = () => {
    if (cancelScheduled) return;
    // Hidden documents get no animation frames; a macrotask still applies output.
    if (document.hidden) {
      const timer = setTimeout(flush, 0);
      cancelScheduled = () => clearTimeout(timer);
    } else {
      const frame = requestAnimationFrame(flush);
      cancelScheduled = () => cancelAnimationFrame(frame);
    }
  };
  return {
    queue(event: AgentEvent) { pending.push(event); schedule(); },
    flush,
    cancel() { cancelScheduled?.(); cancelScheduled = null; pending = []; },
  };
})();

export async function bindRealtime() {
  const unlisteners: (() => void)[] = [];
  try {
    unlisteners.push(await client.onActivityNotification((notice) => {
      useAppStore.setState((state) => {
        if (!state.sessions.some(session => session.id === notice.sessionId) || state.activityNotifications.some(item => item.id === notice.id)) return {};
        if (!state.settingsOpen && state.mainView === "session" && state.selectedSessionId === notice.sessionId && document.hasFocus()) return {};
        return { activityNotifications: retainActivityNotifications([...state.activityNotifications, notice], state.settings.notifications) };
      });
    }));
    unlisteners.push(await client.onNotificationOpen((sessionId) => {
      const store = useAppStore.getState();
      if (!store.sessions.some(session => session.id === sessionId)) return;
      store.setSettingsOpen(false);
      void store.selectSession(sessionId);
    }));
    unlisteners.push(await client.onWindowSnap((event) => { void receiveWindowSnap(event); }));
    unlisteners.push(await client.onAutomationsChanged(() => {
      if (useAppStore.getState().automations) void useAppStore.getState().automationAction({ type: "list" });
    }));
    unlisteners.push(await client.onSessionUpdated((session) => {
      // Earlier deltas apply first; the snapshot then supersedes them by offset.
      outputBatch.flush();
      let reload = false;
      useAppStore.setState((state) => {
        const loaded = state.loadedTranscripts[session.id] !== undefined;
        // Native-created sessions (automation runs) arrive first as an event.
        if (!state.sessions.some((item) => item.id === session.id)) {
          return { sessions: [mergeSessionEvent({ ...session, messages: [] }, session, false).session, ...state.sessions] };
        }
        return {
          // Pins mutate only through serialized metadata acknowledgments. A lifecycle
          // snapshot captured before that acknowledgment must not undo it.
          sessions: state.sessions.map((item) => {
            if (item.id !== session.id) return item;
            const merged = mergeSessionEvent(item, session, loaded);
            reload = merged.reload;
            return merged.session;
          }),
        };
      });
      if (reload) void useAppStore.getState().ensureTranscript(session.id, true);
      // Events carry only the current turn: admission and queue checks read the merged transcript.
      const current = useAppStore.getState().sessions.find((item) => item.id === session.id);
      if (!current) return;
      const admission = directAdmissions.get(current.id);
      if (admission && observedPromptAdmission(current, admission.previousMessageId, admission.prompt)) {
        admission.clear();
        directAdmissions.delete(current.id);
      }
      observePromptQueue(current);
    }));
    unlisteners.push(() => outputBatch.cancel());
    unlisteners.push(await client.onAgentOutput((event) => {
      outputBatch.queue(event);
      const servers = scanLocalServers(event.chunk);
      if (servers.length) useAppStore.getState().noteLocalServers(event.sessionId, servers);
    }));
    unlisteners.push(await client.onPtyOutput((event) => {
      const servers = scanLocalServers(event.data);
      if (servers.length) useAppStore.getState().noteLocalServers(event.sessionId, servers);
    }));
    unlisteners.push(await client.onBrowserState((browser) => {
      useAppStore.setState((state) => ({ browserBySession: { ...state.browserBySession, [browser.sessionId]: browser } }));
    }));
    unlisteners.push(await client.onComputerState((computer) => useAppStore.setState({ computer })));
    unlisteners.push(await client.onBrowserCapture((event) => {
      const owner = `session:${event.sessionId}`;
      void (async () => {
        try {
          const [attachment] = await client.pastePromptAttachments(owner, [{ name: `browser-${Date.now()}.png`, data: event.data }]);
          if (!attachment) return;
          useAppStore.setState((state) => {
            const context = composerContextForOwner(owner, state.composerContexts, state.sessions);
            return { composerContexts: { ...state.composerContexts, [owner]: { ...context, attachments: appendAttachments(context.attachments, [attachment]) } } };
          });
        } catch { /* a screenshot the composer refused is not an app error */ }
      })();
    }));
    unlisteners.push(await client.onAgentExit((event) => {
      outputBatch.flush();
      const store = useAppStore.getState();
      void store.refreshGitStatus();
      const provider = store.sessions.find((session) => session.id === event.sessionId)?.agent;
      // Not forced: the native 60 s cache bounds probes when many turns finish close together.
      if (provider && store.settings.sidebarUsageProviders.includes(provider)) void store.refreshProviderUsage(provider);
    }));
    return () => unlisteners.forEach((unlisten) => unlisten());
  } catch (error) {
    unlisteners.forEach((unlisten) => unlisten());
    throw error;
  }
}

export const selectCurrentProject = (state: AppStore) =>
  state.projects.find((project) => project.id === state.selectedProjectId) ?? null;

export const selectCurrentSession = (state: AppStore) =>
  state.sessions.find((session) => session.id === state.selectedSessionId) ?? null;

/** True when two snapshots of a session differ at most in `messages`. */
export function sameSessionMeta(a: Session, b: Session) {
  if (a === b) return true;
  const left = a as unknown as Record<string, unknown>, right = b as unknown as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key === "messages" || left[key] === right[key]);
}

let sessionsMeta: Session[] = [];
/**
 * Sessions for views that never read `messages` (sidebar, tabs, dock, composer):
 * the returned array keeps its identity while only streamed text changes, so
 * those views skip per-frame renders. Its `messages` may be stale; do not read them.
 */
export const selectSessionsMeta = (state: AppStore): Session[] => {
  const next = state.sessions;
  if (next.length === sessionsMeta.length && next.every((session, index) => sameSessionMeta(sessionsMeta[index], session))) return sessionsMeta;
  sessionsMeta = next;
  return next;
};

let listedFrom: Session[] | null = null;
let listed: Session[] = [];
/** Sessions shown in lists (sidebar, tabs, board, search): side chats live beside their parent (ADR-049). */
export const selectListedSessions = (state: AppStore): Session[] => {
  const meta = selectSessionsMeta(state);
  if (meta !== listedFrom) {
    listedFrom = meta;
    listed = meta.some((session) => session.sideChat) ? meta.filter((session) => !session.sideChat) : meta;
  }
  return listed;
};

let currentMeta: Session | null = null;
/** The selected session for views that never read `messages`; see {@link selectSessionsMeta}. */
export const selectCurrentSessionMeta = (state: AppStore): Session | null => {
  const next = selectCurrentSession(state);
  if (next && currentMeta && sameSessionMeta(currentMeta, next)) return currentMeta;
  currentMeta = next;
  return next;
};

export const selectProjectSessions = (state: AppStore) =>
  state.sessions.filter((session) => session.projectId === state.selectedProjectId);

export const selectEnabledAgents = (state: AppStore) =>
  state.agents.filter(
    (agent) => agent.installed && !state.settings.disabledProviders.includes(agent.id),
  );

let windowSnapSequence = 0;
/**
 * A global window snap joins the composer that is open: the selected session,
 * or the selected project's new-chat landing. Nothing is sent (ADR-054).
 */
async function receiveWindowSnap(event: WindowSnapEvent) {
  const notice = (kind: NonNullable<AppStore["windowSnapNotice"]>["kind"], app?: string) => useAppStore.setState({ windowSnapNotice: { id: ++windowSnapSequence, kind, app } });
  if (event.status !== "ready") { notice(event.status === "needsPermission" ? "permission" : event.status === "ownWindow" ? "own" : "failed"); return; }
  const state = useAppStore.getState();
  const owner = state.selectedSessionId ? `session:${state.selectedSessionId}` : state.selectedProjectId ? `project:${state.selectedProjectId}` : null;
  if (!owner) { void client.windowSnapAction({ type: "discard", nonce: event.nonce }); notice("noComposer"); return; }
  try {
    const attachments = await client.windowSnapAction({ type: "claim", nonce: event.nonce, owner });
    const current = useAppStore.getState();
    const context = composerContextForOwner(owner, current.composerContexts, current.sessions);
    try { current.setComposerContext(owner, { ...context, attachments: appendAttachments(context.attachments, attachments) }); }
    catch (error) { await client.releasePromptAttachments(owner, attachments.map((file) => file.id)); throw error; }
    notice("added", event.app);
  } catch (error) { useAppStore.setState({ error: formatUnknownError(error) }); }
}

// A temporary session is deleted once it is no longer open in any pane and has
// settled; a running turn finishes first. Its worktree is kept (never removed
// without an explicit confirmation).
const deletingTemporary = new Set<string>();
useAppStore.subscribe((state, previous) => {
  if (!state.temporarySessionIds.length) return;
  if (state.selectedSessionId === previous.selectedSessionId && state.sessions === previous.sessions && state.splitLayout === previous.splitLayout && state.temporarySessionIds === previous.temporarySessionIds) return;
  const open = new Set([state.selectedSessionId, ...splitLeaves(state.splitLayout.root).map((leaf) => leaf.sessionId)]);
  for (const id of state.temporarySessionIds) {
    if (open.has(id) || deletingTemporary.has(id)) continue;
    const session = state.sessions.find((item) => item.id === id);
    const forget = () => useAppStore.setState((current) => ({ temporarySessionIds: current.temporarySessionIds.filter((item) => item !== id) }));
    if (!session) { queueMicrotask(forget); continue; }
    if (["starting", "running", "waiting"].includes(session.status)) continue;
    deletingTemporary.add(id);
    void state.deleteSession(id, false).finally(() => { deletingTemporary.delete(id); forget(); });
  }
});

// The active pane follows the selection; panes of deleted sessions close.
useAppStore.subscribe((state, previous) => {
  if (state.selectedSessionId === previous.selectedSessionId && state.sessions === previous.sessions) return;
  const layout = state.splitLayout;
  if (state.sessions !== previous.sessions && state.selectedSessionId === previous.selectedSessionId && splitLeaves(layout.root).length < 2) return;
  const next = splitSync(layout, state.selectedSessionId, new Set(state.sessions.map((session) => session.id)));
  if (next !== layout) useAppStore.setState({ splitLayout: next });
});

// Opening a session loads its transcript; leaving it lets the cache release older ones.
useAppStore.subscribe((state, previous) => {
  if (state.selectedSessionId === previous.selectedSessionId) return;
  if (state.selectedSessionId) void state.ensureTranscript(state.selectedSessionId);
  else releaseTranscripts();
});
