export const AGENT_PROVIDER_IDS = ["codex", "claude", "opencode", "cursor", "grok", "antigravity", "droid", "pi", "devin", "hermes"] as const;
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
  /** Owner-saved Setup and On finish shell scripts (ADR-078). */
  scripts?: ProjectScripts;
}

export interface ProjectScripts { setup?: string | null; onFinish?: string | null }
export type ScriptKind = "setup" | "finish";
export type ScriptRunStatus = "running" | "succeeded" | "failed" | "timedOut" | "cancelled";
/** Latest run of one project script in a session's worktree; `output` is the bounded tail. */
export interface ScriptRun { id: string; kind: ScriptKind; status: ScriptRunStatus; startedAt: string; finishedAt?: string | null; exitCode?: number | null; output: string }
export type ProjectScriptsAction =
  | { type: "save"; projectId: string; setup: string | null; onFinish: string | null }
  | { type: "run"; sessionId: string; kind: ScriptKind }
  | { type: "cancel"; sessionId: string }
  | { type: "dismiss"; sessionId: string; kind: ScriptKind };
export type WorktreeKeptReason = "uncommitted" | "unmerged" | "unverified" | "inUse" | "running" | "failed";
export interface WorktreeLeftover { path: string; bytes: number; kept: WorktreeKeptReason | null }
export interface WorktreeLeftoverScan { leftovers: WorktreeLeftover[]; reclaimableBytes: number }
export interface WorktreeCleanupResult { removed: number; freedBytes: number; kept: WorktreeLeftover[] }
export type WorktreeRelease = { outcome: "released"; branch: string } | { outcome: "kept"; reason: WorktreeKeptReason; branch: string } | { outcome: "missing" };

export interface ProjectFolder { id: string; name: string; look: ProjectLook; projectIds: string[]; collapsed: boolean }
export interface ProjectLook { color?: string | null; emoji?: string | null; logo?: string | null; astro?: ProjectAstroIcon | null; icon?: string | null }
/** One of the Astro cosmic icons as a project icon, drawn in the project colour (ADR-116 kept them). */
export interface ProjectAstroIcon { icon: AstroIconId; style: AstroStyle }
export type AstroIconId = "orbita" | "saturno" | "lua" | "sol" | "galaxia" | "nebulosa" | "cometa" | "buraco" | "estrela" | "pulsar" | "constelacao" | "satelite" | "foguete" | "planeta" | "asteroide" | "eclipse";
export type AstroStyle = "metal" | "neon";
export type ProjectLookAction =
  | { type: "setColor"; projectId: string; color: string | null }
  | { type: "setEmoji"; projectId: string; emoji: string | null }
  | { type: "pickLogo"; projectId: string }
  | { type: "setAstro"; projectId: string; astro: ProjectAstroIcon | null }
  | { type: "clearLogo"; projectId: string }
  | { type: "setIcon"; projectId: string; icon: string | null };

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
export interface ActivityItem { id: string; kind: ActivityKind; label: string; state: ActivityState; model: string | null; detail?: string; offset?: number; output?: string; startedAt?: number | null; endedAt?: number | null; steps?: ActivityStep[]; hiddenSteps?: number;
  /** Claude subagent launched with `run_in_background` (ADR-097); `timedOut` when the turn's limit stopped it. */
  background?: boolean; timedOut?: boolean;
  /** A background shell command rather than a subagent (its `Bash` call is a row of its own). */
  shell?: boolean;
  /** A marker where a background subagent finished (ADR-101): `label` names it, `state` is its outcome; the reply after it is its own answer. */
  finishedTask?: boolean;
  /** Child rows: the Claude tool call that launched the subagent (ADR-111). */
  source?: string;
  /** Child rows: a Claude workflow's phases and members (ADR-115). */
  workflow?: WorkflowProgress; }
export interface WorkflowProgress { name?: string; phases: { index: number; title: string }[]; agents: WorkflowAgent[] }
export interface WorkflowAgent { index: number; label: string; state: "queued" | "running" | "completed" | "failed"; phaseIndex?: number; model?: string; attempt?: number; tokens?: number; toolCalls?: number; durationMs?: number; result?: string; /** While it runs: the end of its answer so far (live only, never saved). */ partial?: string }
export interface TurnReview {
  /** `committedAt`: included in a commit made through Sirus; it leaves the review (ADR-108). */
  files: (FileChange & { binary: boolean; diff: string | null; undoneAt?: string | null; committedAt?: string | null })[];
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
  /** First sentence of the agent's latest reasoning while the turn runs (ADR-101); live only, never in transcript files. */
  thought?: string | null;
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
  /** User messages: what was attached; images keep a thumbnail (see `thumbnailUrl`). */
  attachments?: MessageAttachment[];
  /** Agent replies: sessions started or delegated during the turn (ADR-111). */
  launched?: string[];
  /** Agent replies: HTML visuals published with `sirus_show_visual` (ADR-123). */
  visuals?: MessageVisual[];
}
/** A self-contained HTML visual shown as a sandboxed card in a reply; the same title in a turn replaces it (ADR-123). */
export interface MessageVisual {
  id: string;
  title: string;
  html: string;
  createdAt: string;
  revision: number;
}
export interface MessageAttachment {
  id?: string;
  name: string;
  kind: "file" | "folder";
  mimeType?: string;
  size?: number;
  /** Legacy or fallback only: an embedded `data:image/jpeg;base64,…` copy. */
  thumbnail?: string;
  /** The image's JPEG copy is a file on the Mac, loaded by id (`thumbnailUrl`). */
  hasThumbnail?: boolean;
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
  /** The tab floating in its own window (ADR-111). */
  pictureInPicture?: string | null;
  /** Device mode's CSS size, set by the person or an agent (ADR-111, ADR-112). */
  device?: BrowserDevice | null;
  /** The person's page zoom, 0.5–2 (ADR-112). */
  zoom?: number;
  /** Colour scheme pages see (ADR-112). */
  appearance?: "system" | "light" | "dark";
}
export interface BrowserDevice { width: number; height: number; preset?: string | null }
/** An agent asks the renderer to start or stop recording a session's browser (ADR-112). */
export interface BrowserRecordRequest { requestId: string; sessionId: string; action: "start" | "stop" }

export interface BrowserCaptureEvent {
  sessionId: string;
  data: string;
}

export interface BrowserAnnotation {
  selector: string;
  label: string;
}

/** One side of a conversation moved between computers (ADR-133). */
export interface SessionMoveNote {
  computer: string;
  branch: string;
  at: string;
}

/** What the source computer hands over after pushing a moved conversation's work (ADR-133). */
export interface SessionMoveExport {
  remoteUrl: string;
  branch: string;
  commit: string;
  title: string;
  agent: AgentProviderId;
  model: string | null;
  messages: MovedMessage[];
}

export interface MovedMessage {
  role: "user" | "agent";
  content: string;
  createdAt: string;
}

export interface ImportSessionRequest {
  projectId: string;
  branch: string;
  title: string;
  agent: AgentProviderId;
  model: string | null;
  messages: MovedMessage[];
  fromComputer: string;
  /** The source computer is off: start from this branch as GitHub has it (ADR-133 addendum). */
  fromOrigin?: string | null;
}

export interface HandoffOrigin {
  from: AgentProviderId;
  brief: string;
  request: string;
  pending: boolean;
  /** The recap went out with a prompt the provider has not taken yet (ADR-101). */
  delivering?: boolean;
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
  /** This conversation continued on another computer (ADR-133). */
  movedTo?: SessionMoveNote | null;
  /** This conversation was moved here from another computer (ADR-133). */
  movedFrom?: SessionMoveNote | null;
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
  /** When the person last pressed Stop (ADR-101); cleared by their next send. */
  stoppedByUserAt?: string | null;
  /** Automatic continuations after a crash in a row (ADR-118); absent when 0. */
  autoContinuations?: number;
  /** RFC 3339 instant a snoozed conversation returns (ADR-103); hidden from tabs and lists until then. */
  snoozedUntil?: string | null;
  /** When a snooze reminder fired (ADR-103); the conversation reads as unread until opened. */
  snoozeReminderAt?: string | null;
  /** Auto-archive is off for this conversation (ADR-130); absent when it follows the global rules. */
  autoArchiveDisabled?: boolean;
  execution?: ExecutionOptions;
  pendingRequests?: PendingRequest[];
  /** Coordinator sessions own a team plan and its progress (ADR-043). */
  team?: Team | null;
  /** Worker sessions point back to their coordinator task. */
  teamWorker?: TeamWorker | null;
  /** A side chat answers about this main session and is hidden from session lists (ADR-049). */
  sideChat?: { parentSessionId: string } | null;
  /** The session that delegated this one (`sirus_delegate`) or started it (`sirus_create_session`), ADR-111. */
  delegatedBy?: { sessionId: string; turn: string; notify: boolean; settled: boolean; delivered: boolean } | null;
  /** Project script runs in this session's worktree; `setupPending` until its first turn (ADR-078). */
  scripts?: { setupPending?: boolean; runs?: ScriptRun[] } | null;
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
export interface ActivityNotification { id: string; sessionId: string; kind: "permission" | "question" | "completion" | "failure" | "reminder"; title: string; body: string; createdAt: number; }

export interface SkillOwner { projectId: string | null; sessionId: string | null }
export interface WorkspaceFileSuggestion { path: string; isDir: boolean }
export interface WorkspaceFiles { entries: WorkspaceFileSuggestion[]; truncated: boolean }
export interface SkillSource { id: string; origin: string; scope: "project" | "user"; path: string }
export interface AgentSkill { name: string; description: string; sources: SkillSource[] }
export interface SkillsCatalog { portableDir: string; skills: AgentSkill[]; truncated: boolean }
export type SkillActionResponse = { type: "catalog"; catalog: SkillsCatalog } | { type: "preview"; document: string };

/** MCP manager (ADR-075): providers whose config files Sirus Code reads and edits. */
export type McpProvider = "claude" | "codex" | "opencode" | "cursor";
export type McpScope = "user" | "project" | "local";
/** One configured server; environment and header values never leave the native side. */
export interface McpServer { name: string; provider: McpProvider; scope: McpScope; path: string; transport: "stdio" | "http" | "sse"; command: string | null; args: string[]; url: string | null; envKeys: string[]; headerKeys: string[]; enabled: boolean }
export interface McpProblem { provider: string; path: string; message: string }
export interface McpCatalog { servers: McpServer[]; problems: McpProblem[]; projectPath: string | null }
export interface McpServerInput { name: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>; transport?: "stdio" | "http" | "sse" }
export type McpAction =
  | { type: "list"; projectId: string | null }
  | { type: "add"; projectId: string | null; providers: McpProvider[]; scope: "user" | "project"; server: McpServerInput }
  | { type: "remove"; projectId: string | null; provider: McpProvider; scope: McpScope; name: string };
export interface McpActionResponse { catalog: McpCatalog; failures: McpProblem[] }

export type WindowSnapShortcut = "controlOptionCommandS" | "optionShiftS" | "controlShiftS";
/** `window-snap` event after the global shortcut (ADR-054). */
export type WindowSnapEvent = { status: "ready"; nonce: string; app: string } | { status: "needsPermission" } | { status: "ownWindow" } | { status: "failed" };
/** Why a `sirus://new?…` prompt link was not opened (ADR-122); `prompt_link::LinkError`. */
export type PromptLinkError = "malformed" | "tooLong" | "unknownParameter" | "repeatedParameter" | "noPrompt" | "hiddenOnly" | "project" | "repo" | "provider" | "model" | "pullRequest";
/** A prompt link read and matched by `take_prompt_link` (ADR-122). Nothing is sent. */
export type PromptLinkOutcome =
  | { kind: "open"; prompt: string; hiddenCharacters: number; projectId: string | null; missingProject: string | null; provider: AgentProviderId | null; model: string | null }
  | { kind: "invalid"; reason: PromptLinkError };
export type WindowSnapAction = { type: "claim"; nonce: string; owner: string } | { type: "discard"; nonce: string };

export interface AppSettings {
  notifications: NotificationPreferences;
  usageProviders: AgentProviderId[];
  /** Providers whose quota ring shows in the sidebar rail (at most two). */
  sidebarUsageProviders: AgentProviderId[];
  /** Messages sent while a Codex/Claude reply runs steer it instead of waiting in the queue (ADR-062). */
  steerWhileRunning: boolean;
  /** Owner-authorized CI auto-fix (ADR-064). */
  ciAutoFix: boolean;
  /** Owner switch for PR watch (ADR-079); on by default, each watch is still per session. */
  prWatch: boolean;
  /** Chat behavior (Settings → Chat behavior). */
  dictationEnterSends: boolean;
  foldFinishedTurns: boolean;
  /** The "Working" panel beside the composer while two or more sessions work (ADR-094). */
  showWorkingPanel: boolean;
  /** Chat behavior: macOS spelling and autocorrect in the composers. */
  composerAutocorrect: boolean;
  /** Chat behavior: conversations as tabs in the title bar. */
  showSessionTabs: boolean;
  /** Chat behavior: after a crash, conversations cut mid-turn continue on their own (ADR-118). */
  continueInterruptedSessions: boolean;
  /** Providers → Advanced: finished conversations that keep their agent running (16 = all). */
  keepIdleAgents: number;
  /** Browser recordings (ADR-112): 30 or 60 fps, and key presses and clicks drawn over the video. */
  browserRecordingFps: number;
  browserRecordingKeys: boolean;
  browserRecordingClicks: boolean;
  githubLinksInApp: boolean;
  diffWordWrap: boolean;
  confirmArchive: boolean;
  confirmTerminalClose: boolean;
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
  /** The chat background image file on this Mac (ADR-089), or null. */
  chatBackground: string | null;
  /** How the background is drawn. */
  chatBackgroundEffect: "none" | "dither" | "ascii" | "halftone" | "scanlines" | "haze";
  /** Show it in empty conversations only, or in all of them. */
  chatBackgroundShowOn: "empty" | "all";
  /** Image strength (%) before a conversation has messages, and once it has. */
  chatBackgroundEmptyVisibility: number;
  chatBackgroundSessionVisibility: number;
  worktreeBasePath: string | null;
  /** Archiving removes the session's clean, merged or pushed isolated worktree (ADR-078). */
  releaseWorktreeOnArchive: boolean;
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
  /** Lists the `sirus_*` session tools on every session's MCP bridge (ADR-076). */
  agentsManageSessions: boolean;
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
  /** Working, waiting and unread sessions float above the thread order (ADR-121). */
  sidebarAttentionFirst: boolean;
  pinnedProjectIds: string[];
  /** Switcher folders that group projects (display only). */
  projectFolders: ProjectFolder[];
  pinnedSessionIds: string[];
  archivedSessionIds: string[];
  /** Remote MCP servers every supported agent receives, per project or for all (ADR-137). */
  connectors: Connector[];
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
  /** New conversations start on this approval mode when the provider offers it (ADR-130). */
  defaultApproval: ApprovalMode;
  /** Auto-archive (ADR-130): conversations whose own pull request was merged. */
  autoArchiveMerged: boolean;
  /** Auto-archive (ADR-130): conversations inactive for this many days (1–90), or never. */
  autoArchiveInactiveDays: number | null;
  /** Fast-forward the project checkout's default branch while it has no local changes (ADR-130). */
  gitAutoPull: boolean;
  /** New worktrees start from origin's default branch after a fetch (ADR-130). */
  worktreesFromOrigin: boolean;
  /** How reply text appears while it streams (ADR-130). */
  responseStreaming: ResponseStreaming;
  /** Agents may use the in-app browser tools (ADR-130). */
  agentBrowserAccess: boolean;
}

export type ResponseStreaming = "turn" | "paragraph" | "token";

export interface HostInfo {
  appearanceSupport: AppearanceSupport;
  gitDetected: boolean;
  gitPath: string | null;
  gitVersion: string | null;
  shell: string;
  dataDir: string;
  worktreeRoot: string;
  /** Missing from hosts older than ADR-131. */
  capabilities?: HostCapabilities;
  /** The machine's name; missing from older hosts (ADR-131). */
  hostName?: string;
}

/** What the host can do (ADR-131); the headless Linux host has no window. */
export interface HostCapabilities {
  platform: string;
  headless: boolean;
  browser: boolean;
  computerUse: boolean;
  dictation: boolean;
  pickers: boolean;
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

/** Files pane text search (ADR-095): 1-based line and character column; `text` is a trimmed excerpt. */
export interface TextSearchMatch { line: number; column: number; text: string }
/** `path` is relative to the workspace root, `/`-separated. */
export interface TextSearchFile { path: string; matches: TextSearchMatch[] }
export interface TextSearchResult { files: TextSearchFile[]; truncated: boolean }

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
  /** Every install found on this machine, for Settings → Providers to choose from. */
  candidates?: ExecutableCandidate[];
}

export interface ExecutableCandidate {
  path: string;
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

/** Connectors (ADR-137). Mirrors Rust `connectors::Connector`; sign-in tokens never travel here. */
export type ConnectorAuth = "oauth" | "token" | "none";
export interface Connector {
  id: string;
  /** The catalog entry it came from; none for a custom URL. */
  catalogId?: string;
  name: string;
  url: string;
  /** Only this project's sessions receive it; none means every project. */
  projectId?: string;
  agents: AgentProviderId[];
  enabled: boolean;
  auth: ConnectorAuth;
}
export interface ConnectorStatus { id: string; state: "ready" | "connected" | "signedOut" | "expired" }
export type ConnectorAction =
  | { type: "status" }
  | { type: "signIn"; id: string }
  | { type: "setToken"; id: string; token: string }
  | { type: "signOut"; id: string };
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

/** A private secret card (ADR-077): what the agent asked for, never the value. `path` is the workspace file it will be written to. */
export interface SecretRequest { id: string; sessionId: string; label: string; description: string; envName: string | null; path: string | null }
export interface SecretSnapshot { requests: SecretRequest[] }

/** Remote access (ADR-080): the Mac serving this app to paired devices over Tailscale. */
export type RemoteAction = { type: "status" } | { type: "setEnabled"; enabled: boolean } | { type: "revoke"; deviceId: string }
  | { type: "rename"; deviceId: string; name: string }
  | { type: "enableHttps" } | { type: "disableHttps" } | { type: "openHttpsSetup" } | { type: "testPush"; deviceId: string }
  | { type: "setKeepAwake"; enabled: boolean };
export interface RemoteDevice { id: string; name: string; createdAt: string; lastSeen: string | null; push: boolean }
/** `tailscale serve` in front of remote access, for HTTPS and web push (ADR-082). */
export interface RemoteHttps { available: boolean; url: string | null; setupUrl: string | null; error: string | null }
export interface RemoteStatus { enabled: boolean; running: boolean; port: number; urls: string[]; devices: RemoteDevice[]; error: string | null; https: RemoteHttps; keepAwake: boolean; awake: boolean }
export interface RemotePairing { code: string; urls: string[]; qrSvg: string; expiresAt: string }
/** Closed secret-card controls; `value: null` declines. The value is never echoed back. */
export type SecretAction = { type: "status" } | { type: "respond"; requestId: string; value: string | null };

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
  /** Whole by default; a phone pages back (`limit` messages before index `before`) and asks for
   * `lite` messages without command output or turn review diffs. */
  | { type: "load"; sessionId: string; before?: number; limit?: number; lite?: boolean }
  | { type: "search"; query: string };
export type TranscriptResponse =
  /** `start` is the first message's index in the transcript of `total` (older hosts omit both). */
  | { type: "transcript"; sessionId: string; messages: Message[]; start?: number; total?: number }
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

/** PR watch (ADR-079): a session watching its own pull request. Mirrors Rust `pr_watch::PrWatch`. */
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

/** Devices pane (ADR-128); mirrors `DeviceStatus` in `models.rs`. */
export interface DeviceStatus {
  xcode: boolean;
  nodeVersion: string | null;
  nodeOk: boolean;
  tools: DeviceTools;
  hub: DeviceHubState;
  devices: SimDevice[];
  proxy: DeviceProxy | null;
}
export interface DeviceTools { hubPackage: string; hubVersion: string; installed: boolean; installing: boolean; error: string | null }
export interface DeviceHubState { running: boolean; starting: boolean; error: string | null }
export interface SimDevice { udid: string; name: string; runtime: string; booted: boolean; family: "phone" | "tablet" }
export interface DeviceProxy { port: number; token: string }
export type DeviceAction =
  | { type: "status" }
  | { type: "install"; consent: true }
  | { type: "lease"; id: string }
  | { type: "release"; id: string }
  | { type: "attach"; udid: string }
  | { type: "shutdown"; udid: string; confirm: true }
  | { type: "appearance"; udid: string; dark: boolean }
  | { type: "openUrl"; udid: string; url: string };
/** Where the stream client reaches the device hub proxy: base URLs plus the query token. */
export interface DeviceHubAccess { httpBase: string; wsBase: string; token: string }



/** Guided review (ADR-125): a step-by-step tour of a pull request or a session's changes. Mirrors Rust `review_guides`. */
export type ReviewGuideTarget = { kind: "pullRequest"; repository: string; number: number } | { kind: "session"; sessionId: string };
export interface ReviewGuideAnchor {
  path: string;
  /** `new`: added or kept lines, numbered as in the changed file; `old`: removed lines. */
  side: "new" | "old";
  start: number;
  end: number;
  caption?: string;
}
export interface ReviewGuideStep {
  title: string;
  /** Markdown. */
  body: string;
  /** The one call the reviewer should make here. */
  attention?: string | null;
  anchors: ReviewGuideAnchor[];
}
export interface ReviewGuide {
  id: string;
  target: ReviewGuideTarget;
  title: string;
  summary: string;
  steps: ReviewGuideStep[];
  headSha?: string | null;
  authorSessionId?: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export type ReviewGuideAction = { type: "get"; target: ReviewGuideTarget } | { type: "delete"; target: ReviewGuideTarget };
