export const AGENT_PROVIDER_IDS = ["codex", "claude", "opencode", "cursor", "grok", "antigravity", "droid", "pi", "devin"] as const;
export type AgentProviderId = typeof AGENT_PROVIDER_IDS[number];

export type SessionStatus =
  | "idle"
  | "starting"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "stopped";

export type MessageRole = "user" | "agent" | "system";

export type ChangeKind = "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface Project {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
  /** Display-only folder colour, emoji or logo (ADR-059). */
  look?: ProjectLook;
}

export interface ProjectLook { color?: string | null; emoji?: string | null; logo?: string | null; astro?: ProjectAstroIcon | null }
/** One of the Astro cosmic icons as a project icon, drawn in the project colour. */
export interface ProjectAstroIcon { icon: AstroIconId; style: AstroStyle }
export type ProjectLookAction =
  | { type: "setColor"; projectId: string; color: string | null }
  | { type: "setEmoji"; projectId: string; emoji: string | null }
  | { type: "pickLogo"; projectId: string }
  | { type: "setAstro"; projectId: string; astro: ProjectAstroIcon | null }
  | { type: "clearLogo"; projectId: string };

export interface Worktree {
  path: string;
  branch: string;
  isolated: boolean;
}

export type ActivityKind = "read" | "edit" | "command" | "tool" | "agent" | "skill";
export type ActivityState = "running" | "completed" | "failed" | "stopped" | "unknown";
export interface ActivityStep { id: string; kind: ActivityKind; label: string; state: ActivityState; }
/** Child rows (`kind: "agent"`) may carry their native observation window and their own generic steps. */
/** `detail` names what the step touched (path, command line, query, skill); `offset` is the reply length when it began (UTF-16), placing it in the text. */
export interface ActivityItem { id: string; kind: ActivityKind; label: string; state: ActivityState; model: string | null; detail?: string; offset?: number; output?: string; startedAt?: number | null; endedAt?: number | null; steps?: ActivityStep[]; hiddenSteps?: number; }
export interface TurnReview {
  files: (FileChange & { binary: boolean; diff: string | null; undoneAt?: string | null })[];
  partial: boolean;
  sharedWorkspace: boolean;
  keptAt: string | null;
  expired: boolean;
}
/** Files left as they were: changed again since the turn, or no retained diff (ADR-061). */
export interface UndoTurnOutcome { undone: string[]; refused: string[] }
export interface TurnActivity {
  review?: TurnReview | null;
  provider: AgentProviderId; model: string | null; startedAt: number; endedAt: number | null;
  waitingSince: number | null; pausedMs: number; status: SessionStatus; items: ActivityItem[]; truncated: boolean;
}

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  streaming: boolean;
  activity?: TurnActivity | null;
  /** Instructions sent into this running reply; `offset` is the reply's length when each arrived (ADR-062). */
  steers?: { text: string; at: string; offset: number }[];
  /** User messages: what was attached, with a small thumbnail for images. */
  attachments?: MessageAttachment[];
}
export interface MessageAttachment { name: string; kind: "file" | "folder"; mimeType?: string; size?: number; thumbnail?: string }

export interface NativeThread {
  providerAccountId?: string;
  threadId: string;
  sessionId: string;
  projectId: string;
  cwd: string;
  model: string | null;
}
export interface InputQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: { label: string; description: string }[] | null;
}
export type PendingRequestKind =
  | { type: "command"; command: string; cwd: string | null; reason: string | null }
  | { type: "fileChange"; reason: string | null; changes: { path: string; kind: string; diff: string; movePath: string | null }[] }
  | { type: "userInput"; questions: InputQuestion[] }
  | { type: "tool"; name: string; input: unknown; reason: string | null };
export interface PendingRequest {
  requestId: string;
  generation: string;
  turnId: string;
  itemId: string;
  kind: PendingRequestKind;
}
export type AgentResponse =
  | { type: "approval"; decision: "accept" | "decline" | "cancel" }
  | { type: "userInput"; answers: Record<string, string[]> };
export interface RespondAgentRequest {
  sessionId: string;
  generation: string;
  requestId: string;
  turnId: string;
  response: AgentResponse;
}

export interface ImportOrigin {
  provider: AgentProviderId;
  conversationId: string;
}

export interface BranchInfo {
  name: string;
  current: boolean;
}

export type DictationStatus = "available" | "denied" | "restricted" | "notDetermined" | "unsupported";

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserTabState {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  faviconUrl: string;
}

export interface BrowserSessionState {
  sessionId: string;
  open: boolean;
  tabs: BrowserTabState[];
  activeTabId: string | null;
}

export interface BrowserCaptureEvent {
  sessionId: string;
  data: string;
}

export interface BrowserAnnotation {
  selector: string;
  label: string;
}

/** Astros (ADR-069): persistent assistants on the rail. */
export type AstroIconId = "orbita" | "saturno" | "lua" | "sol" | "galaxia" | "nebulosa" | "cometa" | "buraco" | "estrela" | "pulsar" | "constelacao" | "satelite" | "foguete" | "planeta" | "asteroide" | "eclipse";
export type AstroStyle = "metal" | "neon";
export type AstroBackground = "nebulosa" | "estrelas" | "aurora" | "orbitas" | "liso";
export interface Astro {
  id: string;
  name: string;
  icon: AstroIconId;
  style: AstroStyle;
  color: string;
  background: AstroBackground;
  projectIds: string[];
  soul: string;
  sessionId?: string | null;
  createdAt: string;
  memory: AstroFact[];
  /** Habit reports posted since its conversation was last opened. */
  unread: number;
}
export interface AstroFact { id: string; text: string; createdAt: string }
export interface AstroInput { id: string | null; name: string; icon: AstroIconId; style: AstroStyle; color: string; background: AstroBackground; projectIds: string[]; soul: string }
export type AstroAction =
  | { type: "list" } | { type: "save"; astro: AstroInput } | { type: "open"; id: string }
  | { type: "delete"; id: string; confirm: true } | { type: "reset"; id: string; confirm: true }
  | { type: "remember"; id: string; text: string } | { type: "editFact"; id: string; factId: string; text: string } | { type: "forget"; id: string; factId: string };

export interface HandoffOrigin {
  from: AgentProviderId;
  brief: string;
  request: string;
  pending: boolean;
}

export interface Session {
  /** Native count of user/assistant messages, sent with metadata-only sessions (ADR-048). */
  transcriptLength?: number;
  /** On session events: `messages` holds only `messages[from..]` of `total` (ADR-048). */
  transcriptWindow?: { from: number; total: number };
  goal?: string | null;
  pinnedMessageIds?: string[];
  forkOrigin?: { sourceSessionId: string; sourceMessageId: string; sourceTitle: string; inheritedMessageCount: number; seededNativeThreadId?: string | null } | null;
  importOrigin?: ImportOrigin | null;
  handoff?: HandoffOrigin | null;
  accountBindings?: Partial<Record<AgentProviderId, string>>;
  providerAccountId?: string;
  id: string;
  title: string;
  projectId: string;
  agent: AgentProviderId;
  status: SessionStatus;
  createdAt: string;
  lastActivityAt: string;
  worktree: Worktree;
  messages: Message[];
  lastError: string | null;
  model?: string | null;
  nativeThread?: NativeThread | null;
  /** Latest context-window reading the provider reported (ADR-057). */
  contextUsage?: { used: number; window: number | null } | null;
  /** The last turn hit the provider's usage limit; `resetsAt` in UTC ms when reported. */
  usageLimit?: { resetsAt: number | null } | null;
  execution?: ExecutionOptions;
  pendingRequests?: PendingRequest[];
  /** Coordinator sessions own a team plan and its progress (ADR-043). */
  team?: Team | null;
  /** Worker sessions point back to their coordinator task. */
  teamWorker?: TeamWorker | null;
  /** A side chat answers about this main session and is hidden from session lists (ADR-049). */
  sideChat?: { parentSessionId: string } | null;
  /** The Astro whose conversation this is (ADR-069); hidden from session lists. */
  astro?: string | null;
  /** An Astro started or messaged this session and wants its result back (ADR-069). */
  delegation?: { astroId: string; batch: string; settled: boolean } | null;
}

export type TeamStatus = "planning" | "proposed" | "running" | "ready" | "done" | "stopped" | "failed";
export type TeamTaskState = "pending" | "running" | "done" | "failed" | "stopped";
export type TeamMergeState = "merged" | "skipped" | "conflict" | "outOfScope";
export interface TeamTask {
  id: string; title: string; instructions: string; provider: AgentProviderId; model: string | null; paths: string[]; after: string | null;
  workerSessionId: string | null; state: TeamTaskState; merge: TeamMergeState | null; note: string | null; allowOutside?: boolean;
}
export interface Team { messageId: string; status: TeamStatus; summary: string | null; error: string | null; approval: ApprovalMode | null; tasks: TeamTask[]; }
export interface TeamWorker { coordinatorSessionId: string; taskId: string; }
export interface TeamTaskEdit { id: string; title: string; provider: AgentProviderId; model: string | null; }
/** Closed `side_chat_action`: open (or reuse) the parent's side chat. */
export type SideChatAction = { type: "open"; parentSessionId: string };

export type TeamAction =
  | { type: "start"; sessionId: string; tasks: TeamTaskEdit[]; approval: Exclude<ApprovalMode, "full"> }
  | { type: "stop" | "merge" | "discard"; sessionId: string }
  | { type: "skip" | "mergeAnyway" | "resolve"; sessionId: string; taskId: string }
  | { type: "cleanup"; sessionId: string; confirm: true };
export interface TeamActionResponse { sessions: Session[]; removed: string[]; }


export type MonoFontId = "plexMono" | "jetbrains" | "fira" | "geistMono" | "source" | "roboto" | "ubuntu" | "sfMono" | "menlo" | "cascadia" | "hack" | "consolas";
export interface AppearanceSupport { translucency: boolean; dockIcon: boolean; }

export type NotificationSound = "glass" | "ping" | "pop" | "submarine" | "tink" | "hero";
export interface NotificationPreferences {
  toasts: boolean; system: boolean; sounds: boolean; foreground: boolean;
  permissions: boolean; questions: boolean; completion: boolean;
  permissionSound: NotificationSound; questionSound: NotificationSound; completionSound: NotificationSound;
}
export type NotificationPermission = "prompt" | "granted" | "denied" | "unsupported";
export type NotificationAction = { type: "status" | "request" | "test" | "settings" } | { type: "preview"; sound: NotificationSound };
export interface ActivityNotification { id: string; sessionId: string; kind: "permission" | "question" | "completion"; title: string; body: string; createdAt: number; }

export interface SkillOwner { projectId: string | null; sessionId: string | null }
export interface WorkspaceFileSuggestion { path: string; isDir: boolean }
export interface WorkspaceFiles { entries: WorkspaceFileSuggestion[]; truncated: boolean }
export interface SkillSource { id: string; origin: string; scope: "project" | "user"; path: string }
export interface AgentSkill { name: string; description: string; sources: SkillSource[] }
export interface SkillsCatalog { portableDir: string; skills: AgentSkill[]; truncated: boolean }
export type SkillActionResponse = { type: "catalog"; catalog: SkillsCatalog } | { type: "preview"; document: string };

export type WindowSnapShortcut = "controlOptionCommandS" | "optionShiftS" | "controlShiftS";
/** `window-snap` event after the global shortcut (ADR-054). */
export type WindowSnapEvent = { status: "ready"; nonce: string; app: string } | { status: "needsPermission" } | { status: "ownWindow" } | { status: "failed" };
export type WindowSnapAction = { type: "claim"; nonce: string; owner: string } | { type: "discard"; nonce: string };

export interface AppSettings {
  notifications: NotificationPreferences;
  usageProviders: AgentProviderId[];
  /** Providers whose quota ring shows in the sidebar rail (at most two). */
  sidebarUsageProviders: AgentProviderId[];
  /** Sidebar shows the time-grouped Activity view instead of project folders. */
  sidebarActivityView: boolean;
  /** Messages sent while a Codex/Claude reply runs steer it instead of waiting in the queue (ADR-062). */
  steerWhileRunning: boolean;
  /** Owner-authorized CI auto-fix (ADR-064). */
  ciAutoFix: boolean;
  /** Owner switch for PR watch (ADR-074); on by default, each watch is still per session. */
  prWatch: boolean;
  /** Chat behavior (Settings → Chat behavior). */
  dictationEnterSends: boolean;
  foldFinishedTurns: boolean;
  githubLinksInApp: boolean;
  diffWordWrap: boolean;
  confirmArchive: boolean;
  confirmTerminalClose: boolean;
  autoOpenSimulator: boolean;
  /** Sessions marked Done in the Activity view and when (RFC 3339); newer activity reopens them. */
  doneSessions: { id: string; at: string }[];
  /** System-wide shortcut that snaps the frontmost app window into the open composer (ADR-054). */
  windowSnapEnabled: boolean;
  windowSnapShortcut: WindowSnapShortcut;
  /** Pinned review-inbox items as `owner/repo#number` (ADR-050). */
  githubPins: string[];
  /** Rail customization (ADR-052): item order, hidden items and project shortcuts. */
  railItemOrder: string[];
  hiddenRailItems: string[];
  railProjectShortcuts: string[];
  customShortcuts: Partial<Record<import("../lib/keybindings").ShortcutId, string>>;
  defaultAgent: AgentProviderId;
  openLastProject: boolean;
  /** Projects without a chosen icon show their own favicon or logo. */
  projectAutoIcons: boolean;
  worktreeBasePath: string | null;
  defaultSessionWorkspace: "ask" | "checkout" | "worktree";
  confirmCloseRunning: boolean;
  restorePreviousSessions: boolean;
  checkForUpdates: boolean;
  disabledProviders: AgentProviderId[];
  providerPaths: Partial<Record<AgentProviderId, string>>;
  theme: "dark" | "light" | "system";
  darkWindowTranslucent: boolean;
  lightWindowTranslucent: boolean;
  darkWindowOpacity: number;
  lightWindowOpacity: number;
  darkSidebarTranslucent: boolean;
  lightSidebarTranslucent: boolean;
  darkSidebarOpacity: number;
  lightSidebarOpacity: number;
  translucentOpacity: number;
  systemUiFont: boolean;
  uiFont: "inter" | "geist" | "dmSans" | "plexSans" | "humanist" | "helvetica";
  codeFont: MonoFontId;
  codeFontSize: number;
  terminalFont: MonoFontId;
  fontSmoothing: boolean;
  dockIcon: "default" | "smokedGlass" | "white";
  density: "compact" | "default" | "comfortable";
  animations: boolean;
  composerLineSpeed: "slow" | "smooth" | "fast";
  glass: boolean;
  pointerGlow: boolean;
  reduceMotion: boolean;
  uiFontSize: number;
  gitAutoFetch: boolean;
  gitShowUntracked: boolean;
  gitConfirmDestructive: boolean;
  worktreeLocation: "automatic" | "custom";
  worktreeBranchPattern: string;
  terminalUseSystemShell: boolean;
  terminalFontSize: number;
  terminalCursorStyle: string;
  terminalScrollback: number;
  developerLogs: boolean;
  /** Offers the app-owned computer-use tools to Codex/Claude/OpenCode turns (ADR-038). */
  computerUseEnabled: boolean;
  experimental: boolean;
  disabledModels: string[];
  disabledSkills: string[];
  favoriteModels: string[];
  defaultModel: string | null;
  modelExecution: Record<string, ExecutionOptions>;
  sidebarCollapsed: boolean;
  sidebarProjectOrder: string[];
  sidebarProjectSortOrder: "manual" | "created_at";
  sidebarThreadSortOrder: "updated_at" | "created_at";
  pinnedProjectIds: string[];
  pinnedSessionIds: string[];
  archivedSessionIds: string[];
  environmentPanelDefaultOpen: boolean;
  showEnvironmentUsage: boolean;
  showEnvironmentRepository: boolean;
  showEnvironmentEditor: boolean;
  showEnvironmentPullRequest: boolean;
  showEnvironmentPinned: boolean;
  showEnvironmentNotepad: boolean;
  showEnvironmentInstructions: boolean;
  enableProviderUpdateChecks: boolean;
  locale: "pt-BR" | "en";
}

export interface HostInfo {
  appearanceSupport: AppearanceSupport;
  gitDetected: boolean;
  gitPath: string | null;
  gitVersion: string | null;
  shell: string;
  dataDir: string;
  worktreeRoot: string;
}

export type PullRequestLookupStatus = "ready" | "noPullRequest" | "notGit" | "noCommit" | "unsupportedRemote" | "detached" | "cliMissing" | "authRequired" | "unavailable";
export type PullRequestCheckStatus = "passed" | "failed" | "pending" | "skipped" | "unknown";
export interface PullRequestCheck { id: string; name: string; status: PullRequestCheckStatus; url: string | null; }
export interface PullRequest {
  number: number; title: string; state: "open" | "closed" | "merged"; draft: boolean; url: string;
  headBranch: string; baseBranch: string; headSha: string; localCommitDiffers: boolean;
  checks: PullRequestCheck[]; checksComplete: boolean; checksTruncated: boolean;
}
export interface PullRequestSnapshot {
  sessionId: string; repository: string | null; branch: string | null; localHead: string | null;
  status: PullRequestLookupStatus; checkedAt: string; pullRequest: PullRequest | null;
}

export interface UsageWindow {
  id: string;
  usedPercent: number | null;
  resetsAt: number | null;
  durationMinutes: number | null;
}

export interface UsageAccount {
  email: string | null;
  name: string | null;
  plan: string | null;
  keyFingerprint: string | null;
}

export interface ProviderUsage {
  providerAccountId?: string;
  provider: AgentProviderId;
  status: "available" | "unavailable" | "error";
  windows: UsageWindow[];
  updatedAt: number;
  note: string | null;
  account: UsageAccount | null;
  resetCount: number;
  resetOffer: string | null;
}

export interface CodexResetResult {
  outcome: "reset" | "nothingToReset" | "noCredit" | "alreadyRedeemed";
  usage: ProviderUsage;
}

export interface ProbeResult {
  ok: boolean;
  version: string | null;
  message: string;
}

export interface ProviderAccount { id: string; provider: AgentProviderId; label: string }

export interface ProviderUpdate {
  provider: AgentProviderId;
  installed: boolean;
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  /** False when this installation has no fixed one-click update command. */
  updateSupported: boolean;
}

export interface ProviderUpdateResult {
  provider: AgentProviderId;
  ok: boolean;
  message: string;
}

export interface AppData {
  contextTexts?: Record<string, string>;
  providerAccounts?: ProviderAccount[];
  selectedProviderAccounts?: Partial<Record<AgentProviderId, string>>;
  projects: Project[];
  sessions: Session[];
  settings: AppSettings;
  composerDrafts: Record<string, string>;
}

export interface GitIdentity {
  isRepo: boolean;
  root: string | null;
  branch: string | null;
  detached: boolean;
}

export interface FileChange {
  path: string;
  kind: ChangeKind;
  additions: number;
  deletions: number;
}

export interface GitStatus {
  identity: GitIdentity;
  dirty: boolean;
  ahead: number;
  behind: number;
  changes: FileChange[];
}

export type WorkspaceEntryKind = "file" | "directory";

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface AgentInstall {
  id: AgentProviderId;
  name: string;
  binary: string;
  installed: boolean;
  path: string | null;
  version: string | null;
}

export interface AgentEvent {
  sessionId: string;
  messageId: string;
  /** Native UTF-16 offset for idempotent renderer updates. */
  offset: number;
  message: Message | null;
  stream: string;
  chunk: string;
}

export interface AgentExitEvent {
  sessionId: string;
  code: number | null;
}

export interface PtyOutputEvent {
  sessionId: string;
  terminalId: string;
  data: string;
}

export type EditorId = "finder" | "terminal" | "cursor" | "vscode" | "xcode";
export interface EditorInstall {
  id: EditorId;
  name: string;
  installed: boolean;
}
export interface EditorAppIcon {
  id: EditorId;
  /** Base64 PNG of the real app icon; empty when unavailable. */
  png: string;
}
export interface GitCommitResult {
  hash: string;
  summary: string;
}
export interface GitPushResult {
  branch: string;
}
export interface TextFileSnapshot {
  path: string;
  content: string;
  size: number;
  binary: boolean;
}

export interface CreateSessionRequest {
  projectId: string;
  title?: string;
  agent: AgentProviderId;
  isolatedWorktree: boolean;
  model?: string | null;
}

export type ApprovalMode = "ask" | "auto" | "full";
export interface ExecutionOptions { effort?: string | null; fast?: boolean; planning?: boolean; approval?: ApprovalMode | null }

export interface PromptAttachment { id: string; name: string; kind: "file" | "folder"; content: string; truncated: boolean; mimeType?: string; size?: number; previewUrl?: string | null; owner?: string }
export type WordBlock = { type: "paragraph"; text: string; heading: number; list: boolean } | { type: "table"; rows: string[][] };
export interface DocumentCell { row: number; column: number; value: string; formula: string | null }
export interface DocumentSheet { name: string; rows: number; columns: number; cells: DocumentCell[] }
export type DocumentPreview = { type: "pdf"; data: string } | { type: "word"; blocks: WordBlock[] } | { type: "spreadsheet"; sheets: DocumentSheet[] };

export interface QueuedPromptContext {
  messageId: string | null;
  agent: AgentProviderId;
  model: string | null;
  providerAccountId: string;
  worktreePath: string;
}
export interface SendPromptRequest {
  queuedAfter?: QueuedPromptContext;
  debugging?: boolean;
  goal?: string | null;
  sessionId: string;
  attachmentIds?: string[];
  attachmentOwner?: string;
  prompt: string;
  execution?: ExecutionOptions;
  /** Read-only team planning turn (ADR-043). */
  team?: boolean;
}

export interface DiscoveredModel {
  parameterized?: boolean;
  defaultFast?: boolean;
  effortLevels?: string[];
  defaultEffort?: string | null;
  fastMode?: boolean;
  fastUnavailableReason?: "usage-credits" | "organization" | "model" | "unavailable" | null;
  id: string;
  displayName: string;
  availability: "available" | "unavailable" | "unknown";
}

export interface ProviderModelList {
  provider: AgentProviderId;
  source: string;
  note: string;
  models: DiscoveredModel[];
}

export interface SirusError {
  code: string;
  message: string;
}

export interface GitWorktree {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: string | null;
  prunable: string | null;
}

export interface ComputerRequest { id: string; sessionId: string; app: string; bundleId: string; provider: string }
export interface ComputerGrant { sessionId: string; bundleId: string; app: string }
export interface ComputerHistoryEntry { at: string; sessionId: string; app: string; action: string; outcome: string }
export interface ComputerSnapshot {
  supported: boolean;
  enabled: boolean;
  accessibility: boolean;
  screenRecording: boolean;
  requests: ComputerRequest[];
  grants: ComputerGrant[];
  history: ComputerHistoryEntry[];
  blocked: string[];
}
/** Closed computer-use controls; never paths, URLs or app input from the renderer. */
export type ComputerAction =
  | { type: "status" }
  | { type: "requestAccessibility" }
  | { type: "requestScreenRecording" }
  | { type: "openAccessibilitySettings" }
  | { type: "openScreenRecordingSettings" }
  | { type: "respond"; requestId: string; allow: boolean }
  | { type: "revoke"; sessionId: string; bundleId: string }
  | { type: "stop" };

/** Live Git workspace metadata; renames are explicit deletion/addition paths. */
export interface GitWorkspaceEntry {
  path: string;
  kind: FileChange["kind"];
  conflicted: boolean;
  actionable: boolean;
}
export interface GitHistoryEntry {
  hash: string;
  parents: string[];
  subject: string;
  author: string;
  authoredAt: string;
  refs: string[];
}
export interface GitWorkspaceSnapshot {
  identity: GitIdentity;
  head: string | null;
  indexToken: string;
  staged: GitWorkspaceEntry[];
  unstaged: GitWorkspaceEntry[];
  truncated: boolean;
  conflicts: boolean;
  outsideScope: boolean;
  ahead: number | null;
  behind: number | null;
  history: GitHistoryEntry[];
  historyTruncated: boolean;
}
export type GitWorkspaceAction =
  | { type: "snapshot"; sessionId: string }
  | { type: "stage" | "unstage"; sessionId: string; paths: string[]; expectedIndex: string }
  | { type: "diff"; sessionId: string; path: string; staged: boolean; expectedIndex: string }
  /** Older ancestry below the exact commit the view loaded (`from`), so new commits cannot shift pages. */
  | { type: "history"; sessionId: string; from: string; skip: number }
  /** Explicit fast-forward-only pull of the session branch from origin. */
  | { type: "pull"; sessionId: string; confirm: true };
export type GitWorkspaceResponse =
  | { type: "snapshot"; snapshot: GitWorkspaceSnapshot }
  | { type: "diff"; diff: string }
  | { type: "history"; entries: GitHistoryEntry[]; truncated: boolean }
  | { type: "pulled"; branch: string; summary: string };

export type CommitTitleAction =
  | { type: "generate"; sessionId: string; expectedIndex: string; requestId: string }
  | { type: "cancel"; sessionId: string; requestId: string };
export type CommitTitleResult = { type: "title"; title: string; provider: "codex" | "claude"; partial: boolean };
export type CommitTitleResponse = CommitTitleResult | { type: "cancelled" };

/** Closed read-only transcript access (ADR-048). */
export type TranscriptAction =
  | { type: "load"; sessionId: string }
  | { type: "search"; query: string };
export type TranscriptResponse =
  | { type: "transcript"; sessionId: string; messages: Message[] }
  | { type: "candidates"; sessions: { sessionId: string; messages: Message[] }[]; truncated: boolean };

// Review inbox (ADR-050): pull requests and issues of owned GitHub repositories.
export type GithubItemKind = "pullRequest" | "issue";
/** List filter: `closed` means closed without merging for pull requests. */
export type GithubItemState = "open" | "closed" | "merged";
export type GithubMergeMethod = "merge" | "squash" | "rebase";
export type GithubLookupStatus = "ready" | "cliMissing" | "authRequired" | "unavailable" | string;
export interface GithubLabel { name: string; color: string | null }
export interface GithubItem {
  kind: GithubItemKind;
  repository: string;
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
  isDraft: boolean;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  headRef: string | null;
  baseRef: string | null;
  additions: number;
  deletions: number;
  reviewDecision: string | null;
  mergeable: string | null;
  labels: GithubLabel[];
  commentCount: number;
  assignees: string[];
  reviewRequests: string[];
  checks: string | null;
}
export interface GithubInbox {
  viewer: string | null;
  repositories: { repository: string; projectIds: string[] }[];
  items: GithubItem[];
  failures: { repository: string; status: GithubLookupStatus }[];
  checkedAt: string;
}
export interface GithubDetail {
  item: GithubItem;
  body: string;
  headOid: string | null;
  mergedAt: string | null;
  closedAt: string | null;
  mergeStateStatus: string | null;
  changedFiles: number;
  viewerCanUpdate: boolean;
  mergeMethods: GithubMergeMethod[];
  checks: { name: string; status: "passed" | "failed" | "pending" | "skipped" | "unknown"; url: string | null }[];
  reviewers: string[];
  reviews: { author: string | null; state: string; body: string; submittedAt: string | null }[];
  comments: { author: string | null; body: string; createdAt: string }[];
  commits: { oid: string; headline: string; author: string | null; committedAt: string | null }[];
  files: { path: string; additions: number; deletions: number; changeType: string }[];
  filesTruncated: boolean;
}
export type PullRequestAction =
  | { type: "list"; kind: GithubItemKind; state: GithubItemState }
  | { type: "detail"; repository: string; number: number; kind: GithubItemKind }
  | { type: "diff"; repository: string; number: number }
  | { type: "failures"; repository: string; number: number }
  | { type: "merge"; repository: string; number: number; method: GithubMergeMethod; expectedHead: string; confirm: true }
  | { type: "setDraft"; repository: string; number: number; draft: boolean; confirm: true }
  | { type: "setOpen"; repository: string; number: number; kind: GithubItemKind; open: boolean; confirm: true }
  | { type: "comment"; repository: string; number: number; body: string; confirm: true }
  /** Pushes the session branch and opens a pull request into the default branch. */
  | { type: "create"; sessionId: string; title: string; body: string; draft: boolean; confirm: true };
export type PullRequestResponse =
  | ({ type: "inbox" } & GithubInbox)
  | ({ type: "detail" } & GithubDetail)
  | { type: "diff"; text: string; truncated: boolean }
  | { type: "failures"; checks: GithubFailedCheck[]; truncated: boolean }
  | { type: "created"; url: string }
  | { type: "done" };
/** One failing check with its annotations and an error-focused job log excerpt. */
export interface GithubFailedCheck { name: string; url: string | null; summary: string | null; annotations: string[]; log: string | null }

// Scheduled automations (ADR-051).
export type AutomationSchedule =
  | { kind: "manual" }
  | { kind: "once"; at: string }
  | { kind: "hourly"; minute: number }
  | { kind: "daily"; time: string }
  | { kind: "weekdays"; time: string }
  | { kind: "weekly"; weekday: number; time: string }
  | { kind: "interval"; minutes: number };
export type AutomationWorkspace = "worktree" | "local";
export interface Automation {
  id: string;
  name: string;
  prompt: string;
  projectId: string;
  agent: AgentProviderId;
  model: string | null;
  approval: ApprovalMode;
  planning: boolean;
  workspace: AutomationWorkspace;
  schedule: AutomationSchedule;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  /** A habit of this Astro (ADR-069). */
  astroId?: string | null;
}
export interface AutomationRun {
  id: string;
  automationId: string;
  sessionId: string | null;
  startedAt: string;
  manual: boolean;
  status: "started" | "skipped" | "failed";
  note: string | null;
  reported?: boolean;
}
export interface AutomationSnapshot { automations: Automation[]; runs: AutomationRun[] }
export interface AutomationInput {
  id: string | null;
  name: string;
  prompt: string;
  projectId: string;
  agent: AgentProviderId;
  model: string | null;
  approval: ApprovalMode;
  planning: boolean;
  workspace: AutomationWorkspace;
  schedule: AutomationSchedule;
  enabled: boolean;
  acknowledgeFullAccess: boolean;
  astroId?: string | null;
}
export type AutomationAction =
  | { type: "list" }
  | { type: "upsert"; automation: AutomationInput }
  | { type: "delete"; id: string }
  | { type: "setEnabled"; id: string; enabled: boolean }
  | { type: "runNow"; id: string };

// Tasks (ADR-052).
export type TaskPriority = "none" | "low" | "medium" | "high" | "urgent";
export interface Task {
  id: string;
  title: string;
  notes: string;
  priority: TaskPriority;
  projectId: string | null;
  dueDate: string | null;
  sessionId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface TaskInput { id: string | null; title: string; notes: string; priority: TaskPriority; projectId: string | null; dueDate: string | null }
export type TaskAction =
  | { type: "list" }
  | { type: "upsert"; task: TaskInput }
  | { type: "delete"; id: string }
  | { type: "setDone"; id: string; done: boolean }
  | { type: "unlink"; id: string }
  | { type: "delegate"; id: string; agent: AgentProviderId; model: string | null; approval: ApprovalMode; planning: boolean; isolatedWorktree: boolean };

/** CI auto-fix progress for one session's pull request (ADR-064). */
export interface CiFixState {
  sessionId: string;
  pullRequest: number;
  url: string;
  status: "watching" | "fixing" | "paused" | "off";
  reason?: "attemptLimit" | "noChange" | "interrupted" | "pushFailed" | "stagedChanges" | null;
  detail?: string | null;
  attempts: number;
  handledHead?: string | null;
  checks: string[];
  fixedIn?: number | null;
  updatedAt: string;
}
export type CiFixAction = { type: "status" } | { type: "setEnabled"; sessionId: string; enabled: boolean };

/** PR watch (ADR-074): a session watching its own pull request. Mirrors Rust `pr_watch::PrWatch`. */
export type PrWatchEvent = "checks" | "reviews" | "conflict";
export interface PrWatch {
  sessionId: string;
  repository: string;
  pullRequest: number;
  url: string;
  baseBranch: string;
  origin: "person" | "agent";
  status: "watching" | "stopped";
  reason?: "wakeLimit" | "sendFailed" | null;
  detail?: string | null;
  startedAt: string;
  checkedAt?: string | null;
  head?: string | null;
  failedChecks: string[];
  conflicting: boolean;
  seen: string[];
  wakes: number;
  lastEvents: PrWatchEvent[];
  lastWakeAt?: string | null;
  updatedAt: string;
}
export type PrWatchAction = { type: "status" } | { type: "set"; sessionId: string; watching: boolean };

/** iOS Simulator pane (ADR-066). */
export interface SimulatorDevice { udid: string; name: string; runtime: string; booted: boolean; family: "phone" | "tablet" }
export interface SimulatorAttached { udid: string; name: string; family: "phone" | "tablet"; pixelWidth: number; pixelHeight: number; pointWidth: number; pointHeight: number; input: boolean }
export interface SimulatorFrame { udid: string; sequence: number; timestampMs: number; keyframe: boolean; config: boolean; data: Uint8Array }
export type SimulatorAction =
  | { type: "probe" } | { type: "list" } | { type: "attach"; udid: string } | { type: "detach" }
  | { type: "tap"; x: number; y: number } | { type: "touch"; phase: "down" | "move" | "up"; x: number; y: number }
  | { type: "swipe"; startX: number; startY: number; endX: number; endY: number }
  | { type: "key"; usage: number; phase?: "down" | "up" } | { type: "text"; text: string }
  | { type: "button"; name: "home" | "lock" | "volume-up" | "volume-down" }
  | { type: "screenshot" } | { type: "resync" } | { type: "unwatch"; id: number } | { type: "record"; start: boolean } | { type: "shutdown"; udid: string; confirm: true };
