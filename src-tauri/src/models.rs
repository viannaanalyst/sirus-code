use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatus {
    Idle,
    Starting,
    Running,
    Waiting,
    Completed,
    Failed,
    Stopped,
}

impl SessionStatus {
    pub fn is_active(&self) -> bool {
        matches!(self, Self::Starting | Self::Running | Self::Waiting)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum AgentProviderId {
    Codex,
    Claude,
    #[serde(rename = "opencode")]
    OpenCode,
    Cursor,
    Grok,
    Antigravity,
    Droid,
    Pi,
    Devin,
}

impl AgentProviderId {
    pub fn key(&self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::OpenCode => "opencode",
            Self::Cursor => "cursor",
            Self::Grok => "grok",
            Self::Antigravity => "antigravity",
            Self::Droid => "droid",
            Self::Pi => "pi",
            Self::Devin => "devin",
        }
    }

    /// Model-facing title; keep aligned with `provider-registry.ts` names.
    pub fn title(&self) -> &'static str {
        match self {
            Self::Codex => "Codex",
            Self::Claude => "Claude Code",
            Self::OpenCode => "OpenCode",
            Self::Cursor => "Cursor",
            Self::Grok => "Grok",
            Self::Antigravity => "Antigravity",
            Self::Droid => "Droid",
            Self::Pi => "Pi",
            Self::Devin => "Devin",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MessageRole {
    User,
    Agent,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub added_at: String,
    pub last_opened_at: String,
    /// Display-only folder colour, emoji or logo (ADR-059); empty means the plain folder.
    #[serde(default, skip_serializing_if = "ProjectLook::is_empty")]
    pub look: ProjectLook,
}

/// How a project's sidebar icon looks: one of a logo, an emoji or an Astro icon; the colour tints it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectLook {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,
    /// `data:image/png;base64,…` of a 96×96 PNG made natively from a picked image.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    /// One of the Astro cosmic icons (ADR-059, ADR-069), drawn in the project colour.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub astro: Option<ProjectAstroIcon>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectAstroIcon {
    pub icon: String,
    pub style: String,
}

impl ProjectLook {
    pub fn is_empty(&self) -> bool {
        self.color.is_none() && self.emoji.is_none() && self.logo.is_none() && self.astro.is_none()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub branch: String,
    pub isolated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub session_id: String,
    pub role: MessageRole,
    pub content: String,
    pub created_at: String,
    pub streaming: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity: Option<crate::activity::TurnActivity>,
    /// Instructions the person sent into this running reply (steering); `offset`
    /// is the reply's UTF-16 length when each arrived, so it renders in place.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub steers: Vec<Steer>,
    /// User messages: what was attached, with a small thumbnail for images (ADR-071).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<MessageAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MessageAttachment {
    pub name: String,
    /// `file` or `folder`.
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    /// File size in bytes (files only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    /// `data:image/jpeg;base64,…`, at most 1280 px on its longer side (opens full screen).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Steer {
    pub text: String,
    pub at: String,
    pub offset: usize,
}

/// Exact vendor identity bound to the owning native session and validated workspace.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeThread {
    #[serde(default = "default_account_id")]
    pub provider_account_id: String,
    pub thread_id: String,
    pub session_id: String,
    pub project_id: String,
    pub cwd: String,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputOption {
    pub label: String,
    pub description: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputQuestion {
    pub id: String,
    pub header: String,
    pub question: String,
    #[serde(default)]
    pub is_other: bool,
    #[serde(default)]
    pub is_secret: bool,
    pub options: Option<Vec<InputOption>>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposedFileChange {
    pub path: String,
    pub kind: String,
    pub diff: String,
    pub move_path: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PendingRequestKind {
    Command {
        command: String,
        cwd: Option<String>,
        reason: Option<String>,
    },
    FileChange {
        reason: Option<String>,
        changes: Vec<ProposedFileChange>,
    },
    UserInput {
        questions: Vec<InputQuestion>,
    },
    Tool {
        name: String,
        input: serde_json::Value,
        reason: Option<String>,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingRequest {
    pub request_id: String,
    pub generation: String,
    pub turn_id: String,
    pub item_id: String,
    pub kind: PendingRequestKind,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalDecision {
    Accept,
    Decline,
    Cancel,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum AgentResponse {
    Approval {
        decision: ApprovalDecision,
    },
    UserInput {
        answers: std::collections::BTreeMap<String, Vec<String>>,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RespondAgentRequest {
    pub session_id: String,
    pub generation: String,
    pub request_id: String,
    pub turn_id: String,
    pub response: AgentResponse,
}

/// The provider refused the turn because the account's usage limit is spent.
/// `resets_at` (UTC milliseconds) comes from the provider's own rate-limit report.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageLimit {
    #[serde(default)]
    pub resets_at: Option<i64>,
}

/// Tokens the conversation occupies and the model's window, as the provider reports them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    pub used: u64,
    #[serde(default)]
    pub window: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal: Option<String>,
    #[serde(default)]
    pub pinned_message_ids: Vec<String>,
    #[serde(default)]
    pub fork_origin: Option<ForkOrigin>,
    #[serde(default)]
    pub import_origin: Option<ImportOrigin>,
    /// Pending turn-level handoff: the target provider receives a recap of the
    /// source conversation on the first send, then this is consumed.
    #[serde(default)]
    pub handoff: Option<HandoffOrigin>,
    #[serde(default)]
    pub account_bindings: std::collections::HashMap<AgentProviderId, String>,
    /// Latest context-window reading the provider reported (ADR-057); not inferred.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_usage: Option<ContextUsage>,
    /// Set when the last turn hit the provider's usage limit; cleared by the next send.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage_limit: Option<UsageLimit>,
    pub id: String,
    pub title: String,
    pub project_id: String,
    pub agent: AgentProviderId,
    #[serde(default = "default_account_id")]
    pub provider_account_id: String,
    pub status: SessionStatus,
    pub created_at: String,
    pub last_activity_at: String,
    pub worktree: Worktree,
    /// Each transcript has its own file and loader (ADR-047); memory keeps it inline.
    #[serde(default, skip_serializing_if = "crate::persist::omit_transcripts")]
    pub messages: Vec<Message>,
    pub last_error: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub native_thread: Option<NativeThread>,
    #[serde(default)]
    pub execution: ExecutionOptions,
    // Pending callbacks belong to a live process only; persisted/UI input cannot restore them.
    #[serde(default, skip_deserializing)]
    pub pending_requests: Vec<PendingRequest>,
    /// Coordinator sessions own their team plan and progress (ADR-043).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team: Option<crate::team::Team>,
    /// Worker sessions point back to their coordinator task.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_worker: Option<crate::team::TeamWorker>,
    /// A side chat points back to the main session it answers about (ADR-049).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side_chat: Option<crate::side_chat::SideChatOrigin>,
    /// The Astro whose conversation this is (ADR-069); hidden from session lists.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub astro: Option<String>,
    /// An Astro started or messaged this session and wants its result back.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delegation: Option<crate::astros::Delegation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkOrigin {
    #[serde(default)]
    pub seeded_native_thread_id: Option<String>,
    pub source_session_id: String,
    pub source_message_id: String,
    pub source_title: String,
    pub inherited_message_count: usize,
}

/// Recap a handed-off provider receives on its first turn. `request` is the
/// last user message at the chosen response, shown on the composer card.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HandoffOrigin {
    pub from: AgentProviderId,
    pub brief: String,
    pub request: String,
    #[serde(default)]
    pub pending: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionWorkspacePref {
    Ask,
    Checkout,
    Worktree,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ThemePref {
    Dark,
    Light,
    System,
    /// Retained only for migrating older state; incoming saves reject it.
    Translucent,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UiFont {
    Inter,
    Geist,
    DmSans,
    PlexSans,
    Humanist,
    Helvetica,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MonoFont {
    PlexMono,
    Jetbrains,
    Fira,
    GeistMono,
    Source,
    Roboto,
    Ubuntu,
    SfMono,
    Menlo,
    Cascadia,
    Hack,
    Consolas,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DockIcon {
    Default,
    SmokedGlass,
    White,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DensityPref {
    Compact,
    Default,
    Comfortable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorktreeLocationPref {
    Automatic,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ComposerLineSpeed {
    Slow,
    Smooth,
    Fast,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SidebarProjectSortOrder {
    /// Retired "Recent activity" (`updated_at`) values load as Manual.
    #[serde(alias = "updated_at")]
    Manual,
    CreatedAt,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SidebarThreadSortOrder {
    UpdatedAt,
    CreatedAt,
}

/// Closed choices for the global window snap shortcut.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowSnapShortcut {
    #[default]
    ControlOptionCommandS,
    OptionShiftS,
    ControlShiftS,
}

/// A session marked Done in the Activity view; `at` is the RFC 3339 time it was marked.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DoneSession {
    pub id: String,
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub notifications: crate::notifications::Preferences,
    pub usage_providers: Vec<AgentProviderId>,
    /// Providers whose quota ring shows in the sidebar rail (at most two).
    pub sidebar_usage_providers: Vec<AgentProviderId>,
    /// The sidebar shows the time-grouped Activity view instead of project folders.
    pub sidebar_activity_view: bool,
    /// Messages sent while a Codex/Claude reply runs steer it instead of waiting in the queue.
    pub steer_while_running: bool,
    /// Owner-authorized CI auto-fix: failing PR checks start an automatic fix turn,
    /// then Sirus Code commits and pushes the session branch (ADR-064).
    pub ci_auto_fix: bool,
    /// Chat behavior: Enter while dictating stops and sends instead of only stopping.
    pub dictation_enter_sends: bool,
    /// Chat behavior: a finished turn folds its steps into the "Worked for" line.
    pub fold_finished_turns: bool,
    /// Chat behavior: GitHub pull request/issue links in replies open the Pull requests page.
    pub github_links_in_app: bool,
    /// Chat behavior: diffs wrap long lines by default.
    pub diff_word_wrap: bool,
    /// Chat behavior: ask before archiving a session.
    pub confirm_archive: bool,
    /// Chat behavior: ask before closing a terminal tab.
    pub confirm_terminal_close: bool,
    /// Chat behavior: open the Simulator pane when an agent starts using a simulator (ADR-066).
    pub auto_open_simulator: bool,
    /// Sessions marked Done in the Activity view and when; newer activity reopens them.
    pub done_sessions: Vec<DoneSession>,
    /// System-wide shortcut that snaps the frontmost app window into the open composer (ADR-054).
    pub window_snap_enabled: bool,
    pub window_snap_shortcut: WindowSnapShortcut,
    /// Pinned pull requests/issues in the review inbox, as `owner/repo#number` (ADR-050).
    pub github_pins: Vec<String>,
    /// Rail item order and hidden items (closed IDs; Home cannot be hidden).
    pub rail_item_order: Vec<String>,
    pub hidden_rail_items: Vec<String>,
    /// Project IDs pinned as rail shortcuts.
    pub rail_project_shortcuts: Vec<String>,
    pub custom_shortcuts: std::collections::HashMap<String, String>,
    pub default_agent: AgentProviderId,
    pub open_last_project: bool,
    /// Projects without a chosen icon show their own favicon or logo (off by default).
    pub project_auto_icons: bool,
    pub worktree_base_path: Option<String>,
    pub default_session_workspace: SessionWorkspacePref,
    pub confirm_close_running: bool,
    pub restore_previous_sessions: bool,
    pub check_for_updates: bool,
    pub disabled_providers: Vec<AgentProviderId>,
    pub provider_paths: std::collections::HashMap<AgentProviderId, String>,
    pub theme: ThemePref,
    pub dark_window_translucent: bool,
    pub light_window_translucent: bool,
    pub dark_window_opacity: u32,
    pub light_window_opacity: u32,
    pub dark_sidebar_translucent: bool,
    pub light_sidebar_translucent: bool,
    pub dark_sidebar_opacity: u32,
    pub light_sidebar_opacity: u32,
    pub translucent_opacity: u32,
    pub system_ui_font: bool,
    pub ui_font: UiFont,
    pub code_font: MonoFont,
    pub code_font_size: u32,
    pub terminal_font: MonoFont,
    pub font_smoothing: bool,
    pub dock_icon: DockIcon,
    pub density: DensityPref,
    pub animations: bool,
    pub composer_line_speed: ComposerLineSpeed,
    /// Deprecated compatibility preference; native appearance uses the typed controls above.
    pub glass: bool,
    pub pointer_glow: bool,
    pub reduce_motion: bool,
    pub ui_font_size: u32,
    pub git_auto_fetch: bool,
    pub git_show_untracked: bool,
    pub git_confirm_destructive: bool,
    pub worktree_location: WorktreeLocationPref,
    pub worktree_branch_pattern: String,
    pub terminal_use_system_shell: bool,
    pub terminal_font_size: u32,
    pub terminal_cursor_style: String,
    pub terminal_scrollback: u32,
    pub developer_logs: bool,
    /// Offers the app-owned computer-use MCP server to Codex/Claude/OpenCode turns (ADR-038).
    pub computer_use_enabled: bool,
    pub experimental: bool,
    #[serde(default)]
    pub disabled_models: Vec<String>,
    pub disabled_skills: Vec<String>,
    #[serde(default)]
    pub favorite_models: Vec<String>,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default)]
    pub model_execution: std::collections::HashMap<String, ExecutionOptions>,
    #[serde(default)]
    pub sidebar_collapsed: bool,
    pub sidebar_project_order: Vec<String>,
    pub sidebar_project_sort_order: SidebarProjectSortOrder,
    pub sidebar_thread_sort_order: SidebarThreadSortOrder,
    pub pinned_project_ids: Vec<String>,
    pub pinned_session_ids: Vec<String>,
    pub archived_session_ids: Vec<String>,
    #[serde(default)]
    pub environment_panel_default_open: bool,
    pub show_environment_usage: bool,
    pub show_environment_repository: bool,
    pub show_environment_editor: bool,
    pub show_environment_pull_request: bool,
    pub show_environment_pinned: bool,
    pub show_environment_notepad: bool,
    pub show_environment_instructions: bool,
    #[serde(default = "default_true")]
    pub enable_provider_update_checks: bool,
    #[serde(default = "default_locale")]
    pub locale: String,
}

fn default_locale() -> String {
    "pt-BR".into()
}

fn default_true() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            notifications: Default::default(),
            custom_shortcuts: std::collections::HashMap::new(),
            usage_providers: vec![AgentProviderId::Codex],
            sidebar_usage_providers: Vec::new(),
            sidebar_activity_view: false,
            steer_while_running: false,
            ci_auto_fix: false,
            dictation_enter_sends: false,
            fold_finished_turns: true,
            github_links_in_app: true,
            diff_word_wrap: false,
            confirm_archive: false,
            confirm_terminal_close: true,
            auto_open_simulator: true,
            done_sessions: Vec::new(),
            window_snap_enabled: false,
            window_snap_shortcut: WindowSnapShortcut::default(),
            github_pins: Vec::new(),
            rail_item_order: Vec::new(),
            hidden_rail_items: Vec::new(),
            rail_project_shortcuts: Vec::new(),
            default_agent: AgentProviderId::Codex,
            open_last_project: true,
            project_auto_icons: false,
            worktree_base_path: None,
            default_session_workspace: SessionWorkspacePref::Ask,
            confirm_close_running: true,
            restore_previous_sessions: true,
            check_for_updates: false,
            disabled_providers: Vec::new(),
            provider_paths: std::collections::HashMap::new(),
            theme: ThemePref::Dark,
            dark_window_translucent: false,
            light_window_translucent: false,
            dark_window_opacity: 85,
            light_window_opacity: 85,
            dark_sidebar_translucent: false,
            light_sidebar_translucent: false,
            dark_sidebar_opacity: 72,
            light_sidebar_opacity: 38,
            translucent_opacity: 85,
            system_ui_font: true,
            ui_font: UiFont::Inter,
            code_font: MonoFont::PlexMono,
            code_font_size: 13,
            terminal_font: MonoFont::PlexMono,
            font_smoothing: true,
            dock_icon: DockIcon::Default,
            density: DensityPref::Default,
            animations: true,
            composer_line_speed: ComposerLineSpeed::Slow,
            glass: false,
            pointer_glow: true,
            reduce_motion: false,
            ui_font_size: 13,
            git_auto_fetch: false,
            git_show_untracked: true,
            git_confirm_destructive: true,
            worktree_location: WorktreeLocationPref::Automatic,
            worktree_branch_pattern: "sirus/{session-name}".into(),
            terminal_use_system_shell: true,
            terminal_font_size: 13,
            terminal_cursor_style: "block".into(),
            terminal_scrollback: 2000,
            developer_logs: false,
            computer_use_enabled: false,
            experimental: false,
            disabled_models: Vec::new(),
            disabled_skills: Vec::new(),
            favorite_models: Vec::new(),
            default_model: None,
            model_execution: Default::default(),
            sidebar_collapsed: false,
            sidebar_project_order: Vec::new(),
            sidebar_project_sort_order: SidebarProjectSortOrder::Manual,
            sidebar_thread_sort_order: SidebarThreadSortOrder::CreatedAt,
            pinned_project_ids: Vec::new(),
            pinned_session_ids: Vec::new(),
            archived_session_ids: Vec::new(),
            environment_panel_default_open: false,
            show_environment_usage: true,
            show_environment_repository: true,
            show_environment_editor: true,
            show_environment_pull_request: true,
            show_environment_pinned: true,
            show_environment_notepad: true,
            show_environment_instructions: true,
            enable_provider_update_checks: true,
            locale: default_locale(),
        }
    }
}

/// Customizable rail items (Settings is fixed at the bottom).
pub const RAIL_ITEMS: [&str; 7] = [
    "home",
    "inbox",
    "kanban",
    "tasks",
    "archived",
    "pulls",
    "automations",
];

/// `owner/repo#number`, with the same repository charset as GitHub web URLs.
fn valid_github_pin(pin: &str) -> bool {
    let Some((repo, number)) = pin.split_once('#') else {
        return false;
    };
    pin.len() <= 220
        && number
            .parse::<u32>()
            .is_ok_and(|n| n > 0 && n <= 10_000_000)
        && crate::pull_requests::repository(&format!("https://github.com/{repo}")).is_some()
}

impl AppSettings {
    pub fn validate_controls(&self) -> crate::error::Result<()> {
        crate::skills::validate_disabled(&self.disabled_skills)?;
        use crate::error::Error;
        if self.usage_providers.len() > 9
            || self
                .usage_providers
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != self.usage_providers.len()
        {
            return Err(Error::new(
                "invalid_settings",
                "Invalid usage provider selection.",
            ));
        }
        if self.sidebar_usage_providers.len() > 2
            || self
                .sidebar_usage_providers
                .iter()
                .any(|id| !crate::provider_usage::reports_usage(id))
            || (self.sidebar_usage_providers.len() == 2
                && self.sidebar_usage_providers[0] == self.sidebar_usage_providers[1])
        {
            return Err(Error::new(
                "invalid_settings",
                "Choose at most two providers with usage for the sidebar.",
            ));
        }
        if self.github_pins.len() > 200 || self.github_pins.iter().any(|pin| !valid_github_pin(pin))
        {
            return Err(Error::new(
                "invalid_settings",
                "Invalid pinned pull requests.",
            ));
        }
        let unique = |items: &[String]| {
            items.iter().collect::<std::collections::HashSet<_>>().len() == items.len()
        };
        if self.rail_item_order.len() > RAIL_ITEMS.len()
            || self.hidden_rail_items.len() > RAIL_ITEMS.len()
            || !unique(&self.rail_item_order)
            || !unique(&self.hidden_rail_items)
            || self
                .rail_item_order
                .iter()
                .chain(&self.hidden_rail_items)
                .any(|item| !RAIL_ITEMS.contains(&item.as_str()))
            || self.hidden_rail_items.iter().any(|item| item == "home")
            || self.rail_project_shortcuts.len() > 12
            || !unique(&self.rail_project_shortcuts)
            || self
                .rail_project_shortcuts
                .iter()
                .any(|id| id.is_empty() || id.len() > 128 || id.chars().any(char::is_control))
        {
            return Err(Error::new(
                "invalid_settings",
                "Invalid rail customization.",
            ));
        }
        crate::appearance::validate(self)?;
        if self.model_execution.len() > 512
            || self.model_execution.iter().any(|(key, option)| {
                key.len() > 256
                    || key.chars().any(char::is_control)
                    || !key.contains("::")
                    || option.approval.is_some()
                    || option
                        .effort
                        .as_deref()
                        .is_some_and(|effort| !crate::execution::EFFORTS.contains(&effort))
            })
        {
            return Err(Error::new(
                "invalid_settings",
                "Invalid model execution preferences.",
            ));
        }
        // Provider executable overrides: an absolute path (or a bare command name kept from
        // older data), never relative segments or control characters.
        if self.provider_paths.values().any(|path| {
            path.trim().is_empty()
                || path.len() > 4096
                || path.chars().any(char::is_control)
                || !(std::path::Path::new(path).is_absolute() || !path.contains('/'))
        }) {
            return Err(Error::new(
                "invalid_settings",
                "Invalid provider executable path.",
            ));
        }
        const BINDINGS: [(&str, &str); 17] = [
            ("new-session", "meta+n"),
            ("palette", "meta+k"),
            ("open-project", "meta+o"),
            ("settings", "meta+,"),
            ("toggle-sidebar", "meta+b"),
            ("toggle-context", "meta+\\"),
            ("open-terminal", "meta+`"),
            ("stop-agent", "meta+."),
            ("back", "meta+["),
            ("forward", "meta+]"),
            ("open-files", "meta+alt+o"),
            ("open-browser", "meta+alt+b"),
            ("toggle-environment", "meta+alt+e"),
            ("find-in-conversation", "meta+f"),
            ("search-conversations", "meta+shift+f"),
            ("toggle-side-chat", "meta+alt+s"),
            ("send-new-thread", "meta+alt+enter"),
        ];
        for (id, combo) in &self.custom_shortcuts {
            let mut parts = combo.split('+').collect::<Vec<_>>();
            let key = parts.pop().unwrap_or_default();
            let canonical = ["meta", "alt", "shift"]
                .into_iter()
                .filter(|part| parts.contains(part))
                .chain([key])
                .collect::<Vec<_>>()
                .join("+");
            if !BINDINGS.iter().any(|(known, _)| known == id)
                || combo.len() > 40
                || !parts.contains(&"meta")
                || canonical != *combo
                || parts
                    .iter()
                    .any(|part| !["meta", "alt", "shift"].contains(part))
                || (key == "enter" && parts.len() == 1)
                || (key != "enter"
                    && (key.len() != 1
                        || !key.chars().all(|c| {
                            c.is_ascii_lowercase() || c.is_ascii_digit() || ",.;/\\[]`'".contains(c)
                        })))
                || [
                    "q", "w", "h", "m", "c", "v", "x", "a", "z", "r", "l", "t", "=", "-",
                ]
                .contains(&key)
            {
                return Err(Error::new(
                    "invalid_settings",
                    "Unsupported shortcut combination.",
                ));
            }
        }
        let mut used = std::collections::HashSet::new();
        for (id, fallback) in BINDINGS {
            if !used.insert(
                self.custom_shortcuts
                    .get(id)
                    .map(String::as_str)
                    .unwrap_or(fallback),
            ) {
                return Err(Error::new(
                    "invalid_settings",
                    "Shortcut combinations must be unique.",
                ));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod settings_tests {
    use super::*;
    #[test]
    fn github_pins_are_bounded_owner_repo_numbers() {
        for good in ["owner/repo#1", "my-org/a.b_c#9999"] {
            assert!(valid_github_pin(good), "{good}");
        }
        for bad in [
            "owner/repo",
            "owner/repo#0",
            "owner#1",
            "o/../x#1",
            "o/r#1#2",
            "o/r#-1",
            "https://x#1",
        ] {
            assert!(!valid_github_pin(bad), "{bad}");
        }
        let settings = AppSettings {
            github_pins: vec!["owner/repo#1".into(); 201],
            ..AppSettings::default()
        };
        assert!(settings.validate_controls().is_err());
    }

    #[test]
    fn sidebar_usage_accepts_at_most_two_providers_that_report_usage() {
        let with = |ids: Vec<AgentProviderId>| AppSettings {
            sidebar_usage_providers: ids,
            ..AppSettings::default()
        };
        assert!(serde_json::from_str::<AppSettings>("{}")
            .unwrap()
            .sidebar_usage_providers
            .is_empty());
        assert!(with(vec![AgentProviderId::Codex, AgentProviderId::Claude])
            .validate_controls()
            .is_ok());
        assert!(with(vec![
            AgentProviderId::Codex,
            AgentProviderId::Claude,
            AgentProviderId::Cursor
        ])
        .validate_controls()
        .is_err());
        assert!(with(vec![AgentProviderId::Codex, AgentProviderId::Codex])
            .validate_controls()
            .is_err());
        assert!(with(vec![AgentProviderId::Grok])
            .validate_controls()
            .is_err());
    }

    #[test]
    fn general_preferences_have_legacy_defaults_and_closed_sort_modes() {
        let legacy: AppSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(
            legacy.sidebar_project_sort_order,
            SidebarProjectSortOrder::Manual
        );
        let retired: AppSettings =
            serde_json::from_str(r#"{"sidebarProjectSortOrder":"updated_at"}"#).unwrap();
        assert_eq!(
            retired.sidebar_project_sort_order,
            SidebarProjectSortOrder::Manual
        );
        assert_eq!(
            legacy.sidebar_thread_sort_order,
            SidebarThreadSortOrder::CreatedAt
        );
        assert!(
            legacy.show_environment_usage
                && legacy.show_environment_repository
                && legacy.show_environment_editor
                && legacy.show_environment_pull_request
                && legacy.show_environment_pinned
                && legacy.show_environment_notepad
                && legacy.show_environment_instructions
        );
        for (field, allowed) in [
            ("sidebarProjectSortOrder", vec!["manual", "created_at"]),
            ("sidebarThreadSortOrder", vec!["updated_at", "created_at"]),
        ] {
            for mode in allowed {
                let settings: AppSettings =
                    serde_json::from_value(serde_json::json!({field: mode})).unwrap();
                assert_eq!(serde_json::to_value(settings).unwrap()[field], mode);
            }
            for invalid in [
                serde_json::json!("random"),
                serde_json::json!(100),
                serde_json::Value::Null,
            ] {
                assert!(
                    serde_json::from_value::<AppSettings>(serde_json::json!({field: invalid}))
                        .is_err()
                );
            }
        }
        assert!(serde_json::from_value::<AppSettings>(
            serde_json::json!({"sidebarThreadSortOrder": "manual"})
        )
        .is_err());
        for field in [
            "showEnvironmentUsage",
            "showEnvironmentRepository",
            "showEnvironmentEditor",
            "showEnvironmentPullRequest",
            "showEnvironmentPinned",
            "showEnvironmentNotepad",
            "showEnvironmentInstructions",
        ] {
            let settings: AppSettings =
                serde_json::from_value(serde_json::json!({field: false})).unwrap();
            assert_eq!(serde_json::to_value(settings).unwrap()[field], false);
            assert!(
                serde_json::from_value::<AppSettings>(serde_json::json!({field: "false"})).is_err()
            );
        }
    }
    #[test]
    fn composer_line_speed_is_backward_compatible_and_closed() {
        let legacy: AppSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(legacy.composer_line_speed, ComposerLineSpeed::Slow);
        for speed in ["slow", "smooth", "fast"] {
            let settings: AppSettings = serde_json::from_value(serde_json::json!({
                "composerLineSpeed": speed
            }))
            .unwrap();
            let saved = serde_json::to_value(settings).unwrap();
            assert_eq!(saved["composerLineSpeed"], speed);
        }
        for invalid in [
            serde_json::json!("turbo"),
            serde_json::json!(100),
            serde_json::Value::Null,
        ] {
            assert!(serde_json::from_value::<AppSettings>(serde_json::json!({
                "composerLineSpeed": invalid
            }))
            .is_err());
        }
    }
    #[test]
    fn settings_cannot_store_global_approval_grants() {
        let mut settings = AppSettings::default();
        settings
            .model_execution
            .insert("codex::model".into(), ExecutionOptions::default());
        assert!(settings.validate_controls().is_ok());
        for mode in [ApprovalMode::Ask, ApprovalMode::Auto, ApprovalMode::Full] {
            settings
                .model_execution
                .get_mut("codex::model")
                .unwrap()
                .approval = Some(mode);
            assert!(settings.validate_controls().is_err());
        }
    }
    #[test]
    fn shortcut_controls_reject_collisions_reserved_keys_and_unknown_actions() {
        let mut settings = AppSettings::default();
        for (id, combo) in [
            ("toggle-sidebar", "meta+n"),
            ("palette", "meta+q"),
            ("palette", "meta+meta+b"),
            ("unknown", "meta+shift+b"),
            ("send-new-thread", "meta+enter"),
            ("send-new-thread", "meta+alt+return"),
        ] {
            settings.custom_shortcuts.clear();
            settings.custom_shortcuts.insert(id.into(), combo.into());
            assert!(settings.validate_controls().is_err());
        }
        settings.custom_shortcuts.clear();
        settings
            .custom_shortcuts
            .insert("toggle-sidebar".into(), "meta+shift+b".into());
        assert!(settings.validate_controls().is_ok());
        for (id, combo) in [
            ("forward", "meta+shift+]"),
            ("open-files", "meta+shift+o"),
            ("open-browser", "meta+shift+b"),
            ("toggle-environment", "meta+shift+e"),
            ("find-in-conversation", "meta+alt+f"),
            ("search-conversations", "meta+alt+g"),
            ("toggle-side-chat", "meta+shift+s"),
            ("send-new-thread", "meta+shift+enter"),
        ] {
            settings.custom_shortcuts.clear();
            settings.custom_shortcuts.insert(id.into(), combo.into());
            assert!(settings.validate_controls().is_ok(), "{id}");
        }
        settings.ui_font_size = 100;
        assert!(settings.validate_controls().is_err());
    }
    #[test]
    fn provider_paths_must_be_absolute_or_bare_names() {
        let mut settings = AppSettings::default();
        for (path, ok) in [
            ("/opt/homebrew/bin/claude", true),
            ("claude", true),
            ("bin/claude", false),
            ("../claude", false),
            ("", false),
            ("/bin/claude\n", false),
        ] {
            settings.provider_paths.clear();
            settings
                .provider_paths
                .insert(AgentProviderId::Claude, path.into());
            assert_eq!(settings.validate_controls().is_ok(), ok, "{path:?}");
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    pub projects: Vec<Project>,
    pub sessions: Vec<Session>,
    pub settings: AppSettings,
    #[serde(default)]
    pub provider_accounts: Vec<ProviderAccount>,
    #[serde(default)]
    pub selected_provider_accounts: std::collections::HashMap<AgentProviderId, String>,
    #[serde(default)]
    pub composer_drafts: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub context_texts: std::collections::HashMap<String, String>,
    /// Scheduled automations and their bounded run history (ADR-051).
    #[serde(default)]
    pub automations: Vec<crate::automations::Automation>,
    #[serde(default)]
    pub automation_runs: Vec<crate::automations::Run>,
    /// Per-session CI auto-fix progress and explicit per-PR opt-outs (ADR-064).
    #[serde(default)]
    pub ci_auto_fix: Vec<crate::ci_autofix::FixState>,
    /// Personal tasks, optionally handed to an agent session (ADR-052).
    #[serde(default)]
    pub tasks: Vec<crate::tasks::Task>,
    /// Persistent assistants on the rail (ADR-069).
    #[serde(default)]
    pub astros: Vec<crate::astros::Astro>,
}

pub fn default_account_id() -> String {
    "default".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAccount {
    pub id: String,
    pub provider: AgentProviderId,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIdentity {
    pub is_repo: bool,
    pub root: Option<String>,
    pub branch: Option<String>,
    pub detached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub kind: ChangeKind,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktree {
    pub path: String,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub detached: bool,
    pub bare: bool,
    pub locked: Option<String>,
    pub prunable: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub identity: GitIdentity,
    pub dirty: bool,
    pub ahead: u32,
    pub behind: u32,
    pub changes: Vec<FileChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceEntryKind {
    File,
    Directory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstall {
    pub id: AgentProviderId,
    pub name: String,
    pub binary: String,
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    /// Every install found on this machine, for Settings → Providers to choose from.
    #[serde(default)]
    pub candidates: Vec<ExecutableCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExecutableCandidate {
    pub path: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSupport {
    pub translucency: bool,
    pub dock_icon: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    pub appearance_support: AppearanceSupport,
    pub git_detected: bool,
    pub git_path: Option<String>,
    pub git_version: Option<String>,
    pub shell: String,
    pub data_dir: String,
    pub worktree_root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub ok: bool,
    pub version: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub session_id: String,
    pub message_id: String,
    pub offset: usize,
    pub message: Option<Message>,
    pub stream: String,
    pub chunk: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExitEvent {
    pub session_id: String,
    pub code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyOutputEvent {
    pub session_id: String,
    pub terminal_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    pub hash: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushResult {
    pub branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorInstall {
    pub id: String,
    pub name: String,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportOrigin {
    pub provider: AgentProviderId,
    pub conversation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUpdate {
    pub provider: AgentProviderId,
    pub installed: bool,
    pub installed_version: Option<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
    /// False when this installation has no fixed one-click update command.
    pub update_supported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUpdateResult {
    pub provider: AgentProviderId,
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorAppIcon {
    pub id: String,
    /// Base64 PNG of the real macOS app icon; empty when unavailable.
    pub png: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFileSnapshot {
    pub path: String,
    pub content: String,
    pub size: u64,
    pub binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub project_id: String,
    pub title: Option<String>,
    pub agent: AgentProviderId,
    pub isolated_worktree: bool,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalMode {
    Ask,
    Auto,
    Full,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default, deny_unknown_fields)]
#[derive(Default)]
pub struct ExecutionOptions {
    pub effort: Option<String>,
    pub fast: bool,
    pub planning: bool,
    pub approval: Option<ApprovalMode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendPromptRequest {
    #[serde(default)]
    pub queued_after: Option<QueuedPromptContext>,
    #[serde(default)]
    pub debugging: bool,
    #[serde(default)]
    pub goal: Option<String>,
    pub session_id: String,
    #[serde(default)]
    pub attachment_ids: Vec<String>,
    #[serde(default)]
    pub attachment_owner: String,
    pub prompt: String,
    #[serde(default)]
    pub execution: ExecutionOptions,
    /// Team planning turn: read-only, wrapped with coordinator instructions (ADR-043).
    #[serde(default)]
    pub team: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueuedPromptContext {
    pub message_id: Option<String>,
    pub agent: AgentProviderId,
    pub model: Option<String>,
    pub provider_account_id: String,
    pub worktree_path: String,
}
