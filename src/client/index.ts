import { LocalTransport } from "./local-transport";
import type { Transport } from "./transport";
import type {
  AgentEvent,
  AgentExitEvent,
  AgentInstall,
  AgentProviderId,
  AppData,
  AppSettings,
  CreateSessionRequest,
  FileEntry,
  GitIdentity,
  GitStatus,
  HostInfo,
  ProbeResult,
  Project,
  ProviderModelList,
  PtyOutputEvent,
  SendPromptRequest,
  Session,
} from "./types";

type SharedListener = { handlers: Set<(payload: unknown) => void>; ready: Promise<() => void> };

export class SwitchyardClient {
  private readonly transport: Transport;
  private readonly shared = new Map<string, SharedListener>();
  constructor(transport: Transport) { this.transport = transport; }

  /**
   * One native listener per event, fanned out to every handler. Each native
   * listener receives its own serialized payload, so several terminals listening
   * separately would multiply the cost of every output chunk.
   */
  private listenShared<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
    let entry = this.shared.get(event);
    if (!entry) {
      const handlers = new Set<(payload: unknown) => void>();
      const created: SharedListener = {
        handlers,
        ready: this.transport.listen<unknown>(event, (payload) => { for (const each of [...handlers]) each(payload); }),
      };
      created.ready.catch(() => { if (this.shared.get(event) === created) this.shared.delete(event); });
      this.shared.set(event, created);
      entry = created;
    }
    const current = entry;
    const own = handler as (payload: unknown) => void;
    current.handlers.add(own);
    return current.ready.then(() => () => {
      current.handlers.delete(own);
      if (current.handlers.size || this.shared.get(event) !== current) return;
      this.shared.delete(event);
      void current.ready.then((unlisten) => unlisten());
    }, (error: unknown) => {
      current.handlers.delete(own);
      throw error;
    });
  }

  loadState() {
    return this.transport.invoke<AppData>("load_state");
  }

  async skillsCatalog(owner: import("./types").SkillOwner) {
    const result = await this.transport.invoke<import("./types").SkillActionResponse>("skill_action", { action: { type: "catalog", owner } });
    if (result.type !== "catalog") throw new Error("Unexpected skill catalog response");
    return result.catalog;
  }
  async skillPreview(owner: import("./types").SkillOwner, sourceId: string) {
    const result = await this.transport.invoke<import("./types").SkillActionResponse>("skill_action", { action: { type: "preview", owner, sourceId } });
    if (result.type !== "preview") throw new Error("Unexpected skill preview response");
    return result.document;
  }

  providerUsage(provider: AgentProviderId, refresh = false, accountId?: string) {
    return this.transport.invoke<import("./types").ProviderUsage>("provider_usage", { provider, refresh, accountId });
  }

  createProviderAccount(provider: AgentProviderId, name: string) {
    return this.transport.invoke<import("./types").ProviderAccount>("create_provider_account", { provider, name });
  }
  selectProviderAccount(provider: AgentProviderId, accountId: string) {
    return this.transport.invoke<void>("select_provider_account", { provider, accountId });
  }
  renameProviderAccount(provider: AgentProviderId, accountId: string, name: string) {
    return this.transport.invoke<import("./types").ProviderAccount>("rename_provider_account", { provider, accountId, name });
  }
  loginProviderAccount(provider: AgentProviderId, accountId: string) {
    return this.transport.invoke<void>("login_provider_account", { provider, accountId });
  }
  cancelProviderAccountLogin(provider: AgentProviderId, accountId: string) {
    return this.transport.invoke<void>("cancel_provider_account_login", { provider, accountId });
  }

  consumeCodexReset(offer: string) {
    return this.transport.invoke<import("./types").CodexResetResult>("consume_codex_reset", { offer, confirm: true });
  }

  providerUpdates(refresh = false) {
    return this.transport.invoke<import("./types").ProviderUpdate[]>("provider_updates", { refresh });
  }

  updateProviders(providers: AgentProviderId[]) {
    return this.transport.invoke<import("./types").ProviderUpdateResult[]>("update_providers", { providers, confirm: true });
  }

  saveSettings(settings: AppSettings) {
    return this.transport.invoke<AppSettings>("save_settings", { settings });
  }

  saveComposerDraft(key: string, value: string) {
    return this.transport.invoke<void>("save_composer_draft", { key, value });
  }

  saveContextText(key: string, value: string, flush = false) {
    return this.transport.invoke<void>("save_context_text", { key, value, flush });
  }

  pastePromptAttachments(owner: string, files: { name: string; data: string }[], expectedText?: string) {
    return this.transport.invoke<import("./types").PromptAttachment[]>("paste_prompt_attachments", { owner, files, expectedText: expectedText ?? null });
  }
  releasePromptAttachments(owner: string, ids: string[]) {
    return this.transport.invoke<void>("release_prompt_attachments", { owner, ids });
  }
  pickPromptAttachments(owner: string, folder?: boolean) {
    return this.transport.invoke<import("./types").PromptAttachment[]>("pick_prompt_attachments", { owner, folder });
  }
  capturePromptWindow(owner: string) {
    return this.transport.invoke<import("./types").PromptAttachment[]>("capture_prompt_window", { owner });
  }
  attachmentPreview(owner: string, id: string) {
    return this.transport.invoke<import("./types").DocumentPreview>("attachment_preview", { owner, id });
  }

  pickFolder() {
    return this.transport.invoke<string | null>("pick_folder");
  }

  addProject(path: string) {
    return this.transport.invoke<Project>("add_project", { path });
  }

  removeProject(projectId: string) {
    return this.transport.invoke<void>("remove_project", { projectId });
  }

  openProject(projectId: string) {
    return this.transport.invoke<Project>("open_project", { projectId });
  }

  projectLookAction(action: import("./types").ProjectLookAction) {
    return this.transport.invoke<Project | null>("project_look_action", { action });
  }

  renameProject(projectId: string, name: string) {
    return this.transport.invoke<Project>("rename_project", { projectId, name });
  }

  gitIdentity(path: string) {
    return this.transport.invoke<GitIdentity>("git_identity", { path });
  }

  gitStatus(sessionId: string) {
    return this.transport.invoke<GitStatus>("git_status", { sessionId });
  }

  gitDiff(sessionId: string, path: string) {
    return this.transport.invoke<string>("git_diff", { sessionId, path });
  }

  listBranches(projectId: string) {
    return this.transport.invoke<import("./types").BranchInfo[]>("list_branches", { projectId });
  }

  checkoutBranch(projectId: string, branch: string) {
    return this.transport.invoke<void>("checkout_branch", { projectId, branch, confirm: true });
  }

  createBranch(projectId: string, branch: string) {
    return this.transport.invoke<void>("create_branch", { projectId, branch, confirm: true });
  }

  /** Saves Markdown of an owned conversation where the person picks in the native dialog (ADR-060); false when cancelled. */
  exportConversation(sessionId: string, markdown: string) {
    return this.transport.invoke<boolean>("export_conversation", { sessionId, markdown });
  }

  /** One session's full transcript, loaded when a view needs it (ADR-048). */
  async loadTranscript(sessionId: string) {
    const result = await this.transport.invoke<import("./types").TranscriptResponse>("transcript_action", { action: { type: "load", sessionId } });
    if (result.type !== "transcript" || result.sessionId !== sessionId) throw new Error("Unexpected transcript response");
    return result.messages;
  }

  /** Bounded candidate messages for the all-conversations search; matching stays in the renderer. */
  async searchTranscripts(query: string) {
    const result = await this.transport.invoke<import("./types").TranscriptResponse>("transcript_action", { action: { type: "search", query } });
    if (result.type !== "candidates") throw new Error("Unexpected transcript search response");
    return result;
  }

  async gitWorkspaceHistory(sessionId: string, from: string, skip: number) {
    const result = await this.transport.invoke<import("./types").GitWorkspaceResponse>("git_workspace_action", { action: { type: "history", sessionId, from, skip } });
    if (result.type !== "history") throw new Error("Unexpected Git history response");
    return { entries: result.entries, truncated: result.truncated };
  }

  /** Explicit fast-forward-only pull of the session branch. */
  async gitPull(sessionId: string) {
    const result = await this.transport.invoke<import("./types").GitWorkspaceResponse>("git_workspace_action", { action: { type: "pull", sessionId, confirm: true } });
    if (result.type !== "pulled") throw new Error("Unexpected Git pull response");
    return result;
  }

  /** Pushes the session branch and opens a pull request; resolves to its GitHub URL. */
  async createPullRequest(sessionId: string, title: string, body: string, draft: boolean) {
    const result = await this.transport.invoke<import("./types").PullRequestResponse>("pull_request_action", { action: { type: "create", sessionId, title, body, draft, confirm: true } });
    if (result.type !== "created") throw new Error("Unexpected pull request response");
    return result.url;
  }

  async gitWorkspace(action: Exclude<import("./types").GitWorkspaceAction, { type: "diff" | "history" | "pull" }>) {
    const result = await this.transport.invoke<import("./types").GitWorkspaceResponse>("git_workspace_action", { action });
    if (result.type !== "snapshot") throw new Error("Unexpected Git workspace response");
    return result.snapshot;
  }

  async gitWorkspaceDiff(sessionId: string, path: string, staged: boolean, expectedIndex: string) {
    const result = await this.transport.invoke<import("./types").GitWorkspaceResponse>("git_workspace_action", { action: { type: "diff", sessionId, path, staged, expectedIndex } });
    if (result.type !== "diff") throw new Error("Unexpected Git diff response");
    return result.diff;
  }

  async gitCommitTitle(sessionId: string, expectedIndex: string, requestId: string): Promise<import("./types").CommitTitleResult | null> {
    const action: import("./types").CommitTitleAction = { type: "generate", sessionId, expectedIndex, requestId };
    const response = await this.transport.invoke<unknown>("commit_title_action", { action });
    if (isCancelledTitle(response)) return null;
    if (!response || typeof response !== "object") throw new Error("Unexpected commit title response");
    const value = response as Record<string, unknown>;
    if (Object.keys(value).length !== 4 || value.type !== "title" || typeof value.title !== "string" || !value.title.trim() || value.title.trim() !== value.title || Array.from(value.title).length > 72 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(value.title) || (value.provider !== "codex" && value.provider !== "claude") || typeof value.partial !== "boolean") throw new Error("Unexpected commit title response");
    return value as import("./types").CommitTitleResult;
  }
  async cancelCommitTitle(sessionId: string, requestId: string): Promise<void> {
    const action: import("./types").CommitTitleAction = { type: "cancel", sessionId, requestId };
    const response = await this.transport.invoke<unknown>("commit_title_action", { action });
    if (!isCancelledTitle(response)) throw new Error("Unexpected commit title cancellation response");
  }

  gitCommit(sessionId: string, message: string, expectedIndex?: string) {
    return this.transport.invoke<import("./types").GitCommitResult>("git_commit", { sessionId, message, expectedIndex });
  }

  gitPush(sessionId: string) {
    return this.transport.invoke<import("./types").GitPushResult>("git_push", { sessionId });
  }

  projectRemoteUrl(projectId: string) {
    return this.transport.invoke<string | null>("project_remote_url", { projectId });
  }

  sessionPullRequest(sessionId: string) {
    return this.transport.invoke<import("./types").PullRequestSnapshot>("session_pull_request", { sessionId });
  }

  openExternalUrl(url: string) {
    return this.transport.invoke<void>("open_external_url", { url });
  }

  detectEditors() {
    return this.transport.invoke<import("./types").EditorInstall[]>("detect_editors");
  }

  editorAppIcons() {
    return this.transport.invoke<import("./types").EditorAppIcon[]>("editor_app_icons");
  }

  openInEditor(sessionId: string, editor: import("./types").EditorId, path?: string | null) {
    return this.transport.invoke<void>("open_in_editor", { sessionId, editor, path: path ?? null });
  }

  readTextFile(sessionId: string, path: string) {
    return this.transport.invoke<import("./types").TextFileSnapshot>("read_text_file", { sessionId, path });
  }

  writeTextFile(sessionId: string, path: string, content: string) {
    return this.transport.invoke<void>("write_text_file", { sessionId, path, content });
  }

  listWorktrees(projectId: string) {
    return this.transport.invoke<import("./types").GitWorktree[]>("list_worktrees", { projectId });
  }

  listDir(sessionId: string, path?: string) {
    return this.transport.invoke<FileEntry[]>("list_dir", { sessionId, path });
  }

  /** Moves one session-owned entry to the system Trash (recoverable). */
  trashWorkspaceEntry(sessionId: string, path: string): Promise<void> {
    return this.transport.invoke<void>("trash_workspace_entry", { sessionId, path });
  }

  createWorkspaceEntry(sessionId: string, kind: import("./types").WorkspaceEntryKind, name: string, parentPath?: string): Promise<FileEntry> {
    return this.transport.invoke<FileEntry>("create_workspace_entry", { sessionId, kind, name, parentPath });
  }

  workspaceFiles(owner: import("./types").SkillOwner, query: string) {
    return this.transport.invoke<import("./types").WorkspaceFiles>("workspace_files", { owner, query });
  }

  detectAgents() {
    return this.transport.invoke<AgentInstall[]>("detect_agents");
  }

  hostInfo() {
    return this.transport.invoke<HostInfo>("host_info");
  }

  probeProvider(id: AgentProviderId, path?: string | null) {
    return this.transport.invoke<ProbeResult>("probe_provider", { id, path });
  }

  pickExecutable() {
    return this.transport.invoke<string | null>("pick_executable");
  }

  openPath(path: string) {
    return this.transport.invoke<void>("open_path", { path });
  }

  createSession(request: CreateSessionRequest) {
    return this.transport.invoke<Session>("create_session", { request });
  }

  renameSession(sessionId: string, title: string) {
    return this.transport.invoke<Session>("rename_session", { sessionId, title });
  }

  forkSession(sessionId: string, messageId: string) {
    return this.transport.invoke<Session>("fork_session", { sessionId, messageId });
  }

  /** `newWorktree` moves the handoff into a new isolated worktree seeded from the current checkout. */
  handoffSession(sessionId: string, messageId: string, agent: import("./types").AgentProviderId, model: string | null, newWorktree = false) {
    return this.transport.invoke<Session>("handoff_session", { sessionId, messageId, agent, model, newWorktree });
  }

  /** Stops a localhost server only when Switchyard started it; resolves to the processes signalled. */
  stopLocalServer(sessionId: string, url: string) {
    return this.transport.invoke<number>("local_server_action", { action: { type: "stop", sessionId, url } });
  }

  dismissHandoff(sessionId: string) {
    return this.transport.invoke<Session>("dismiss_handoff", { sessionId });
  }

  /** Sends an instruction into the session's running Codex/Claude reply (ADR-062). */
  steerTurn(sessionId: string, text: string) {
    return this.transport.invoke<void>("steer_turn", { sessionId, text });
  }

  /** Reverses a settled turn's retained diffs, file by file, after a check (ADR-061). */
  undoTurnChanges(sessionId: string, messageId: string, paths?: string[]) {
    return this.transport.invoke<import("./types").UndoTurnOutcome>("undo_turn_changes", { request: { sessionId, messageId, paths, confirm: true } });
  }

  keepTurnChanges(sessionId: string, messageId: string) {
    return this.transport.invoke<import("./types").TurnReview>("keep_turn_changes", { sessionId, messageId });
  }

  setMessagePinned(sessionId: string, messageId: string, pinned: boolean) {
    return this.transport.invoke<string[]>("set_message_pinned", { sessionId, messageId, pinned });
  }

  setSessionAgent(sessionId: string, agent: AgentProviderId) {
    return this.transport.invoke<Session>("set_session_agent", { sessionId, agent });
  }

  setSessionModel(sessionId: string, agent: AgentProviderId, model?: string | null) {
    return this.transport.invoke<Session>("set_session_model", { sessionId, agent, model });
  }

  listProviderModels(id: AgentProviderId) {
    return this.transport.invoke<ProviderModelList>("list_provider_models", { id });
  }

  deleteSession(sessionId: string, removeWorktree: boolean, confirm: boolean) {
    return this.transport.invoke<void>("delete_session", {
      sessionId,
      removeWorktree,
      confirm,
    });
  }

  sendPrompt(request: SendPromptRequest) {
    return this.transport.invoke<Session>("send_prompt", { request });
  }

  taskAction(action: import("./types").TaskAction) {
    return this.transport.invoke<import("./types").Task[]>("task_action", { action });
  }

  automationAction(action: import("./types").AutomationAction) {
    return this.transport.invoke<import("./types").AutomationSnapshot>("automation_action", { action });
  }

  ciAutofixAction(action: import("./types").CiFixAction) {
    return this.transport.invoke<import("./types").CiFixState[]>("ci_autofix_action", { action });
  }

  onCiAutofixChanged(handler: () => void) {
    return this.transport.listen<unknown>("ci-autofix-changed", () => handler());
  }

  onAutomationsChanged(handler: () => void) {
    return this.transport.listen<unknown>("automations-changed", () => handler());
  }

  pullRequestAction(action: import("./types").PullRequestAction) {
    return this.transport.invoke<import("./types").PullRequestResponse>("pull_request_action", { action });
  }

  sideChatAction(action: import("./types").SideChatAction) {
    return this.transport.invoke<Session>("side_chat_action", { action });
  }

  teamAction(action: import("./types").TeamAction) {
    return this.transport.invoke<import("./types").TeamActionResponse>("team_action", { action });
  }

  respondAgentRequest(request: import("./types").RespondAgentRequest) {
    return this.transport.invoke<void>("respond_agent_request", { request });
  }

  stopAgent(sessionId: string) {
    return this.transport.invoke<void>("stop_agent", { sessionId });
  }

  startTerminal(sessionId: string, terminalId: string, cols: number, rows: number) {
    return this.transport.invoke<void>("start_terminal", { sessionId, terminalId, cols, rows });
  }

  writeTerminal(sessionId: string, terminalId: string, data: string) {
    return this.transport.invoke<void>("write_terminal", { sessionId, terminalId, data });
  }

  resizeTerminal(sessionId: string, terminalId: string, cols: number, rows: number) {
    return this.transport.invoke<void>("resize_terminal", { sessionId, terminalId, cols, rows });
  }

  stopTerminal(sessionId: string, terminalId: string) {
    return this.transport.invoke<void>("stop_terminal", { sessionId, terminalId });
  }

  onAgentOutput(handler: (event: AgentEvent) => void) {
    return this.transport.listen<AgentEvent>("agent-output", handler);
  }

  onSessionUpdated(handler: (session: Session) => void) {
    return this.transport.listen<Session>("session-updated", handler);
  }

  notificationAction(action: import("./types").NotificationAction) {
    return this.transport.invoke<import("./types").NotificationPermission>("notification_action", { action });
  }
  onActivityNotification(handler: (notice: import("./types").ActivityNotification) => void) {
    return this.transport.listen<import("./types").ActivityNotification>("notification-activity", handler);
  }
  onNotificationOpen(handler: (sessionId: string) => void) {
    return this.transport.listen<string>("notification-open", handler);
  }

  onAgentExit(handler: (event: AgentExitEvent) => void) {
    return this.transport.listen<AgentExitEvent>("agent-exit", handler);
  }

  onPtyOutput(handler: (event: PtyOutputEvent) => void) {
    return this.listenShared<PtyOutputEvent>("pty-output", handler);
  }

  onPtyExit(handler: (event: PtyOutputEvent) => void) {
    return this.listenShared<PtyOutputEvent>("pty-exit", handler);
  }

  dictationStatus() {
    return this.transport.invoke<import("./types").DictationStatus>("dictation_status");
  }

  startDictation(locale: string) {
    return this.transport.invoke<void>("start_dictation", { locale });
  }

  stopDictation(cancel = true) {
    return this.transport.invoke<string | null>("stop_dictation", { cancel });
  }

  browserOpen(sessionId: string) {
    return this.transport.invoke<import("./types").BrowserSessionState>("browser_open", { sessionId });
  }

  browserClose(sessionId: string) {
    return this.transport.invoke<void>("browser_close", { sessionId });
  }

  browserState(sessionId: string) {
    return this.transport.invoke<import("./types").BrowserSessionState>("browser_state", { sessionId });
  }

  browserNewTab(sessionId: string, url: string | null) {
    return this.transport.invoke<import("./types").BrowserSessionState>("browser_new_tab", { sessionId, url });
  }

  browserCloseTab(sessionId: string, tabId: string) {
    return this.transport.invoke<import("./types").BrowserSessionState>("browser_close_tab", { sessionId, tabId });
  }

  browserSelectTab(sessionId: string, tabId: string) {
    return this.transport.invoke<import("./types").BrowserSessionState>("browser_select_tab", { sessionId, tabId });
  }

  browserNavigate(sessionId: string, tabId: string, url: string) {
    return this.transport.invoke<import("./types").BrowserSessionState>("browser_navigate", { sessionId, tabId, url });
  }

  browserReload(sessionId: string, tabId: string) {
    return this.transport.invoke<import("./types").BrowserSessionState>("browser_reload", { sessionId, tabId });
  }

  browserBack(sessionId: string, tabId: string) {
    return this.transport.invoke<import("./types").BrowserSessionState>("browser_back", { sessionId, tabId });
  }

  browserForward(sessionId: string, tabId: string) {
    return this.transport.invoke<import("./types").BrowserSessionState>("browser_forward", { sessionId, tabId });
  }

  browserSetBounds(sessionId: string, bounds: import("./types").BrowserBounds | null) {
    return this.transport.invoke<void>("browser_set_bounds", { sessionId, bounds });
  }

  browserAnnotateStart(sessionId: string, tabId: string) {
    return this.transport.invoke<void>("browser_annotate_start", { sessionId, tabId });
  }

  browserAnnotateFinish(sessionId: string, tabId: string) {
    return this.transport.invoke<import("./types").BrowserAnnotation[]>("browser_annotate_finish", { sessionId, tabId });
  }

  browserAnnotateCancel(sessionId: string, tabId: string) {
    return this.transport.invoke<void>("browser_annotate_cancel", { sessionId, tabId });
  }

  browserCopyLink(sessionId: string, tabId: string) {
    return this.transport.invoke<void>("browser_copy_link", { sessionId, tabId });
  }

  browserCapture(sessionId: string, tabId: string) {
    return this.transport.invoke<string>("browser_capture", { sessionId, tabId });
  }


  computerAction(action: import("./types").ComputerAction) {
    return this.transport.invoke<import("./types").ComputerSnapshot>("computer_action", { action });
  }

  windowSnapAction(action: import("./types").WindowSnapAction) {
    return this.transport.invoke<import("./types").PromptAttachment[]>("window_snap_action", { action });
  }

  onWindowSnap(handler: (event: import("./types").WindowSnapEvent) => void) {
    return this.transport.listen<import("./types").WindowSnapEvent>("window-snap", handler);
  }

  onComputerState(handler: (state: import("./types").ComputerSnapshot) => void) {
    return this.transport.listen<import("./types").ComputerSnapshot>("computer-state", handler);
  }

  simulatorAction<T = unknown>(action: import("./types").SimulatorAction) {
    return this.transport.invoke<T>("simulator_action", { action });
  }

  /** Frames arrive in small batches (at most ~30 events per second). */
  onSimulatorFrames(handler: (frames: import("./types").SimulatorFrame[]) => void) {
    return this.transport.listen<{ frames: import("./types").SimulatorFrame[] }>("simulator-frame", (event) => handler(event.frames ?? []));
  }

  onSimulatorState(handler: (state: { attached: import("./types").SimulatorAttached | null }) => void) {
    return this.transport.listen<{ attached: import("./types").SimulatorAttached | null }>("simulator-state", handler);
  }

  onSimulatorOpen(handler: (event: { sessionId: string }) => void) {
    return this.transport.listen<{ sessionId: string }>("simulator-open", handler);
  }

  onBrowserState(handler: (state: import("./types").BrowserSessionState) => void) {
    return this.transport.listen<import("./types").BrowserSessionState>("browser-state", handler);
  }

  onBrowserCapture(handler: (event: import("./types").BrowserCaptureEvent) => void) {
    return this.transport.listen<import("./types").BrowserCaptureEvent>("browser-capture", handler);
  }

}

export const client = new SwitchyardClient(new LocalTransport());

function isCancelledTitle(value: unknown): boolean {
  return !!value && typeof value === "object" && Object.keys(value).length === 1 && (value as Record<string, unknown>).type === "cancelled";
}
