# ADR-019: Header environment card, right dock and workspace editors

**Status:** Accepted

The Explorer creation restriction is superseded by
[ADR-044](ADR-044-explicit-workspace-entry-creation.md); editor overwrite/save
and the no-rename/no-delete policy remain unchanged.

The live Changes launcher, explicit index preparation and guarded Commit flow
are extended by [ADR-045](ADR-045-explicit-git-index-workflow.md).

## Context

The session header only showed the provider mark and title. Workspace actions
(Changes, worktrees, commit and push, local servers, usage, repository, editors)
were split across a segmented Context panel with seven permanent tabs, while the
target workflow asks for a compact Environment card plus a dock that starts with
Terminal and Files and grows with tabs.

The request also required features the native layer did not expose yet: multiple
terminals per session, explicit `git commit` / `git push`, opening fixed editors,
opening validated external URLs, and an in-app text editor that can write files.
All of these cross the IPC, FS, PTY and network boundaries the project treats as
security reviews.

## Decision

- `App.tsx` header keeps the session identity and adds two controls:
  `EnvironmentToggle` and the right-dock toggle. `EnvironmentPanel`
  (`src/components/EnvironmentPanel.tsx`) is a fixed card overlay pinned to the
  top-right of the content column (not an anchored popover). It is a fixed
  window, not a popup: clicks elsewhere keep reaching the app and do not dismiss
  it; only the toggle, Escape or an action closes it. It shows real data only:
  Changes opens the dock Changes pane, Local/worktree path, branch with the
  worktree inventory, explicit Commit and Push, Local Servers detected from
  terminal/agent output, provider usage, Repository (GitHub `origin` derived in
  Rust, otherwise the project folder) and Editor actions. The toggle uses
  Synara's window glyph (`src/components/icons/WindowIcon.tsx`).
- `RightDock` (`src/components/RightDock.tsx`) replaces the segmented
  `ContextPanel` and is a full-height root-level column beside the main column,
  like the sidebar: its top row uses the window-controls height, is a Tauri drag
  region, and its surface uses the chat background (`background-0`) so both
  columns read as one material. An empty dock lists Terminal and Files; opened
  panes become tabs with add, close, maximize and resize. Changes and Editor
  panes are reachable from the Environment card and from Files, matching the
  dock's launcher contract. `ContextPanel` is deleted; its other views remain as
  standalone components without a dock entry.
- Terminals are identified by `terminalId`, not by session. `pty_term.rs` keys
  `PtyMap` by terminal id and stores the owning session; every command checks the
  owner. Each session is bounded to eight panes
  (`MAX_TERMINALS_PER_SESSION` in `commands.rs` and `app-store.ts`); `pty-output`
  and `pty-exit` carry `terminalId`; deleting a session kills its terminals.
  The workspace mirrors Synara's terminal: `columns | rows` split regions, each
  region holding terminal tabs with its own header (chips, `+`, and the region
  actions: move active tab to its own region, split right/down with Phosphor
  glyphs, and trash that closes the region's active terminal). The dock resize handle
  uses an extended invisible hit area, and its width clamps to keep at least
  440px for the chat column (`viewport - sidebar - 440`), so it can be dragged
  much wider than before without squeezing the transcript into a sliver. The
  terminal surface uses `background-0`, the same material as the chat.
- `git_commit` is explicit, keeps the existing hooks/filters guards, takes the
  message as one argv entry and never stages by itself. `git_push` is explicit,
  never forces, refuses a detached HEAD, and refuses repositories whose
  project-local config defines network helpers (`credential.*`,
  `core.sshCommand`, `core.gitProxy`, `core.askPass`,
  `remote.*.uploadpack/receivepack/proxy`, `url.*.insteadOf`, `http*.proxy`)
  because they can redirect credentials or connections. `GIT_TERMINAL_PROMPT=0`
  keeps a push from hanging on an interactive prompt.
- `editor.rs` owns a fixed editor allowlist (`finder`, `terminal`, `cursor`,
  `vscode`, `xcode`). The renderer picks an id; app names and flags are native.
  `editor_app_icons` extracts each installed app's real macOS icon
  (`NSWorkspace.iconForFile` → PNG → base64, bounded to the fixed bundles) so
  the Open in… list matches Synara's native icons; the renderer falls back to
  lucide glyphs when a bundle or platform is unavailable. The Repository row
  uses the Simple Icons GitHub mark.
  `read_text_file` / `write_text_file` operate only on existing regular files
  inside the session cwd, refuse `.git` segments, cap reads at 2 MiB and writes
  at 1 MiB, open with `O_NOFOLLOW` and re-verify the opened descriptor before
  reading; writes truncate only after verification. Editor buffers live in the
  store so unsaved edits survive pane, session and dock switches, and closing a
  dirty tab asks for confirmation.
  CodeMirror passes the existing trusted head style's `nonce` property through
  `EditorView.cspNonce` so generated gutter/layout/highlight styles work under
  the packaged CSP without relaxing it. Its palette follows the resolved app
  theme. Startup supplies the same nonce to Radix's existing dynamic scroll-guard
  stylesheet API; no renderer-provided nonce or CSP exception is admitted. The
  code scrolls horizontally, and Markdown wraps and has a read-only preview.
  Writes are explicit through Save/Command-S; no timer or unmount writes to disk.
  The existing store owns a per-editor-key save gate across mounted views and
  navigation, and a successful write advances only the captured buffer's saved
  baseline, preserving text typed during the request. Discard is blocked while
  a write is pending; buffer identity refuses acknowledgments after owner removal
  and recreation. File-keyed mounts separate CodeMirror undo histories.
- Browser-style Back/Forward arrows live in the titlebar cluster. The store keeps
  a bounded in-memory history of `{ mainView, project, session }` selections
  (50 entries) recorded by a single state subscriber; replay resolves deleted
  projects/sessions to a live fallback and never records the replay itself.
  `⌘[` drives settings-back while Settings is open and navigation otherwise;
  `⌘]` is forward.
- While the Environment card is open and the dock is closed it insets the chat
  column by 312px (288px card + 12px gutters) instead of covering it; with the
  dock open it only overlays, matching Synara. `AppSettings.environmentPanelDefaultOpen`
  (General → Environment panel → Open by default) reopens it on startup, and the
  header toggle is the only action that persists it; action/Escape closes keep
  the preference.
- Interactive controls get `cursor: pointer` from a base rule for enabled
  buttons, `role="button"` and links.
- General persists `showEnvironmentUsage`, `showEnvironmentRepository` and
  `showEnvironmentEditor` through existing settings saves; all default to true
  for legacy state. Hidden sections and their dividers are unmounted. A hidden
  Repository skips its metadata probe, and a hidden Editor does not mount its
  editor-discovery effect. Usage visibility does not change footer visibility
  or native quota authorization. Workspace actions and all native boundaries
  remain intact.
- Environment reference sections (pinned-message navigation, session Notepad
  and project instructions) follow [ADR-030](ADR-030-environment-context-references.md).
  Their visibility preferences use the same General settings path.
- The branch-owned PR/checks card follows [ADR-031](ADR-031-read-only-pull-request-checks.md).
  It uses native read-only GitHub CLI metadata and the existing external opener.
- The chat column (transcript and composer) uses `--chat-column-width: 736px`,
  Synara's standard 46rem at a 16px root. The app pins its root to 13px
  (`applyAppearance`) so Synara-derived measurements are expressed in pixels:
  panel width 288px, 12px edge gutters, 6px content padding, 2px stack gaps,
  13px row text with 16px icons, 8px/4px row padding, 12px section labels and
  4px divider margins.
- `open_external_url` accepts http(s) only, rejects credentials in the URL and
  allows a fixed host set (`localhost`, `127.0.0.1`, `::1`, `github.com`).
  GitHub links are normalized from `origin` in Rust; the renderer never supplies
  the repository URL.
- `project_remote_url` is read-only and returns only a normalized GitHub https
  URL, never the raw remote.

## Consequences

- **Positive:** one compact Environment card backed by real data; the dock
  matches the terminal/files workflow; multiple terminals per session; explicit
  commit and push with project-config guards; editors and links stay allowlisted
  and jailed; unsaved editor edits survive navigation.
- **Negative:** the standalone Workspaces and CLI-diagnostics views have no UI
  entry (components stay in the tree); terminal processes restart when the dock
  pane remounts for another session, because PTYs are owned per terminal and
  stopped on unmount; editor sessions have no rename/create/delete support.
- **Accepted trade-off:** push relies on the CLI's own credential handling
  (never on tokens in the app) and therefore still depends on the user's Git
  configuration, while the guards above only cover project-local overrides.

## Alternatives considered

- Keep the segmented Context panel and add a second right panel: rejected —
  duplicate docks, conflicting shortcuts and two sources of truth for terminal
  visibility.
- Keep PTYs keyed by session and emulate tabs in the renderer: rejected —
  one shell per session cannot back independent tabs.
- Open editors through the frontend shell/fs plugins: rejected by the transport
  boundary and the capability contract; all spawn and FS work stays in Rust.
- Reuse Synara's browser/iOS-simulator/side-chat panes: out of scope; the
  launcher deliberately starts with Terminal and Files only.
