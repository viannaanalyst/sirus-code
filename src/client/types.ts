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
}

export interface Worktree {
  path: string;
  branch: string;
  isolated: boolean;
}

export type ActivityKind = "read" | "edit" | "command" | "tool" | "agent";
export type ActivityState = "running" | "completed" | "failed" | "stopped" | "unknown";
export interface ActivityStep { id: string; kind: ActivityKind; label: string; state: ActivityState; }
/** Child rows (`kind: "agent"`) may carry their native observation window and their own generic steps. */
export interface ActivityItem { id: string; kind: ActivityKind; label: string; state: ActivityState; model: string | null; startedAt?: number | null; endedAt?: number | null; steps?: ActivityStep[]; hiddenSteps?: number; }
export interface TurnReview {
  files: (FileChange & { binary: boolean; diff: string | null })[];
  partial: boolean;
  sharedWorkspace: boolean;
  keptAt: string | null;
  expired: boolean;
}
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
}

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
  execution?: ExecutionOptions;
  pendingRequests?: PendingRequest[];
  /** Coordinator sessions own a team plan and its progress (ADR-043). */
  team?: Team | null;
  /** Worker sessions point back to their coordinator task. */
  teamWorker?: TeamWorker | null;
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
export type TeamAction =
  | { type: "start"; sessionId: string; tasks: TeamTaskEdit[]; approval: Exclude<ApprovalMode, "full"> }
  | { type: "stop" | "merge" | "discard"; sessionId: string }
  | { type: "skip" | "mergeAnyway" | "resolve"; sessionId: string; taskId: string }
  | { type: "cleanup"; sessionId: string; confirm: true };
export interface TeamActionResponse { sessions: Session[]; removed: string[]; }

export type ProfileAvatarColor = "silver" | "blue" | "green" | "rose" | "amber";
export interface LocalProfile { name: string; handle: string; avatarColor: ProfileAvatarColor; avatarImage: string | null; }
export type ProfileImageAction = "copy" | "save" | "x" | "linkedin" | "reddit";
export type ProfileImageResult = "copied" | "saved" | "cancelled" | "composerOpened";

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

export interface AppSettings {
  notifications: NotificationPreferences;
  profile: LocalProfile;
  usageProviders: AgentProviderId[];
  customShortcuts: Partial<Record<import("../lib/keybindings").ShortcutId, string>>;
  defaultAgent: AgentProviderId;
  openLastProject: boolean;
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
  profileDefaultName?: string;
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

export interface SwitchyardError {
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
  | { type: "history"; sessionId: string; from: string; skip: number };
export type GitWorkspaceResponse =
  | { type: "snapshot"; snapshot: GitWorkspaceSnapshot }
  | { type: "diff"; diff: string }
  | { type: "history"; entries: GitHistoryEntry[]; truncated: boolean };

export type CommitTitleAction =
  | { type: "generate"; sessionId: string; expectedIndex: string; requestId: string }
  | { type: "cancel"; sessionId: string; requestId: string };
export type CommitTitleResult = { type: "title"; title: string; provider: "codex" | "claude"; partial: boolean };
export type CommitTitleResponse = CommitTitleResult | { type: "cancelled" };

/** Closed read-only transcript access (ADR-048). */
export type TranscriptAction =
  | { type: "load"; sessionId: string }
  | { type: "search"; query: string }
  | { type: "activity" };
export type TranscriptResponse =
  | { type: "transcript"; sessionId: string; messages: Message[] }
  | { type: "candidates"; sessions: { sessionId: string; messages: Message[] }[]; truncated: boolean }
  | { type: "activity"; sessions: { sessionId: string; prompts: { id: string; createdAt: string }[] }[] };
