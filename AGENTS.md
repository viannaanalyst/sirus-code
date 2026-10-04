# AGENTS.md

Operational rules for anyone — human or coding agent — working in **Switchyard**.

This file is the permanent working contract. Architecture that agents must not violate lives here because the tree is still small. Rationale lives in [`docs/decisions/`](docs/decisions/README.md). How to write docs: [`docs/documentation-conventions.md`](docs/documentation-conventions.md).

**The product is not a chat wrapper.** The model is:

**Project → Sessions → Agents → Worktrees → reviewable changes.**

Several sessions may run in parallel. Their Git trees must not mix.

---

## Before you change anything

1. Read this file.
2. If the task depends on existing architecture (Session, IPC, AgentProvider, Worktree, Client/Transport, bugs that cross UI and Rust), **use Graphify first** — see § Graphify.
3. Read ADRs for the area you will touch.
4. Invoke **only** the host skills that match the task (see § Skills). Do not invent skills. Do not load Next.js / Electron / Streamlit skills.
5. Plan briefly, then implement. A change is not done when files are written.

Trivial local edits (copy, padding, colour token already defined, typo, icon swap) skip Graphify rebuilds and skip extra skills.

---

## Graphify

Graphify is the structural map of this repo. Integration on this machine: CLI `graphify` (package `graphifyy` via uv), skill at `~/.codex/skills/graphify/SKILL.md`. There is no `$graphify` helper and no `/graphify` slash-command in Cursor — **run the `graphify` binary** (or the Python API in that skill).

Project-scoped config:

- [`.graphifyignore`](.graphifyignore) — extra exclusions (`node_modules`, `target`, lockfiles, icons, `graphify-out`)
- Outputs: `graphify-out/graph.json`, `graphify-out/GRAPH_REPORT.md`

**When `graphify-out/graph.json` exists, query it before grepping the whole tree** for architecture questions.

```bash
graphify query "How does Session start an agent?"
graphify path "SwitchyardClient" "AgentProcess"
graphify explain "Worktree"
graphify update .          # incremental after structural edits
```

Do **not** rebuild the full graph for copy/CSS/typos. Never full-rebuild if `graphify update .` is enough. If you delete a lot of code and the shrink-guard refuses, `graphify update . --force`.

Read `GRAPH_REPORT.md` for a wide map. Use query/path/explain for a specific relation.

---

## Skills

Skills live in the **developer environment**, not in this repository:

| Area | Use when | Examples on this host (do not invent others) |
| --- | --- | --- |
| Graphify | Architecture questions, cross-module change | `~/.codex/skills/graphify` |
| Planning | Non-trivial features | `writing-plans`, `brainstorming` — only if the task is genuinely large |
| React / Vite | Frontend implementation or review | `react-best-practices`, `react-vite-best-practices` |
| Tauri 2 | Rust commands, `tauri.conf.json`, IPC (`invoke` / events / channels), plugins, packaging, white-screen / capability errors | `tauri-v2` — `~/.agents/skills/tauri-v2` ([catalog](https://skills.sh/nodnarbnitram/claude-code-extensions/tauri-v2)) |
| Tauri security | Capabilities, CSP, plugin permission strings, origin/runtime authority | `tauri-security` — `~/.agents/skills/tauri-security` ([catalog](https://skills.sh/full-stack-skills/tauri-skills/tauri-security)) |
| UI | Visual work | `frontend-design`, `ui-skills-root` (then the smallest UI skill), `tailwind-theme-builder` if tokens break |
| A11y | Keyboard, focus, labels | `fixing-accessibility` |
| Git worktrees | Isolated feature branches | `using-git-worktrees` |
| Debug | Unexpected behaviour | `systematic-debugging` |
| Done? | Before claiming complete | `verification-before-completion` |
| Review | Before merge-scale work | `requesting-code-review` / `receiving-code-review` |

**Do not use:** Next.js skills, Electron patterns, shadcn unmodified dumps, GSAP (this app uses Motion + CSS).

**This file beats generic Tauri skills.** Host skills above describe v2 patterns. They must not override Switchyard rules: the webview is untrusted; UI must not import `@tauri-apps/api` except inside `LocalTransport`; there is no `execute_any_command`; do not add frontend `shell` / `fs` plugins; new IPC is a security review. Ignore skill advice that puts `invoke` in React components, enables `shell:allow-execute`, or treats Isolation pattern / extra plugins as defaults.

Skip Tauri skills for CSS, copy, and Settings layout. Read them before changing `src-tauri/`, capabilities, CSP, process spawn, or the Client/Transport boundary.

Pick few. Read them before coding. Never spray twenty skills on a padding change.

---

## Stack (actual)

| Layer | Choice |
| --- | --- |
| Desktop | Tauri 2 (`com.switchyard.app`) |
| UI | React 19, TypeScript strict, Vite 8 |
| Style | Tailwind CSS v4 (`@tailwindcss/vite`) |
| Primitives | Radix + vendored UI Arc MIT components through existing primitives |
| Motion | `motion` (Motion for React) + CSS tokens |
| Icons | lucide-react |
| State | Zustand (`src/store/app-store.ts`) — do not add another store |
| Native | Rust 2021 edition, crate `switchyard` / lib `switchyard_lib` |
| Git | Git CLI argv + worktrees |
| Terminal | portable-pty + `@xterm/xterm` |
| Persistence | JSON files (metadata index + per-session transcripts), not SQLite |

No Next.js. No Electron. No app login.

---

## Architecture (current)

```
React UI (src/)
  → SwitchyardClient (src/client/index.ts)
    → Transport (src/client/transport.ts)
      → LocalTransport (src/client/local-transport.ts)  # Tauri invoke/listen
      → RemoteTransport                                 # NOT IMPLEMENTED
        → Tauri IPC
          → Rust commands (src-tauri/src/commands.rs + lib.rs pick_folder)
```

**UI must not import `@tauri-apps/api` except inside `LocalTransport`.** Preserve this for a future host that speaks the same Client API over a secure remote protocol. Do not implement Remote unless asked.

Trust boundary: the webview is untrusted. Rust validates every path and every process spawn.

### Native modules (`src-tauri/src/`)

| File | Role |
| --- | --- |
| `lib.rs` | Plugins, `AppState`, command allowlist, `pick_folder` |
| `commands.rs` | IPC handlers + `AppState` |
| `models.rs` | Serde domain (`camelCase` JSON) |
| `persist.rs` | Atomic metadata `state.json` plus one `sessions/<id>.json` transcript per session; content-hashed writes, generation-ordered, coalesced streaming checkpoints (ADR-047) |
| `profile.rs` / `profile_image.rs` | Bounded local display identity, decoded JPEG preferences and closed native PNG Copy/Save/social actions |
| `notifications.rs` / `notifications_macos.rs` | native-owned successful-turn/permission/question alerts, closed sound presets and explicit OS authorization/test controls |
| `appearance.rs` | Closed persisted appearance controls, main-thread macOS glass backing, original Dock icon restoration and embedded Smoked Glass/White alternatives |
| `skills.rs` | Bounded native skill catalog, source-ID read-only previews and explicit owner-bound portable instructions; fixed roots and verified file handles |
| `diagnostics.rs` | opt-in bounded lifecycle counts; no content, paths or credentials |
| `close.rs` | native close/Quit authorization and one pending running-agent dialog |
| `sidebar.rs` | bounded owner-validated sidebar pins/archives and project display-name edits |
| `drafts.rs` | owner-validated unsent drafts; event-driven native persistence |
| `context_text.rs` | bounded owner-validated session notes and project instructions; local reference metadata |
| `pull_requests.rs` | session-owned read-only GitHub origin PR/check snapshots through bounded fixed gh GET probes |
| `transcript.rs` | owner-validated assistant pins and bounded transcript fork reconstruction |
| `transcript_view.rs` | renderer view without full transcripts: metadata-only `load_state`, turn-windowed `session-updated`, closed read-only `transcript_action` (load / bounded search candidates / prompt activity) |
| `team.rs` | Team orchestration: read-only coordinator plan (≤3 validated tasks), confirmed start into isolated-worktree helper sessions, settlement-driven dependencies, explicit in-order merge to the working copy without commits, closed `team_action` |
| `paths.rs` | Canonicalize / jail |
| `git.rs` | status, diff, identity, worktree list |
| `commit_title.rs` | closed owner/request-bound prepared-index title inference, isolated Codex/Claude utility, bounded cancellation/shutdown cleanup; no chat or Git mutations |
| `git_workspace.rs` | closed session-owned index preparation/diffs, whole-index commit guard and bounded local commit ancestry |
| `worktree.rs` | isolated `worktree add` / confirmed remove |
| `fs_tree.rs` | lazy directory listing and bounded, owner-scoped composer filename suggestions; ignores `node_modules` `.git` `target` … |
| `workspace_entries.rs` | explicit session-owned empty file/folder creation; bounded single names, Unix descriptor-relative non-overwriting admission |
| `editor.rs` | fixed editor allowlist (`detect_editors` / `open_in_editor`), real app icons (`editor_app_icons`) and jailed bounded text read/overwrite |
| `cli_output.rs` | bounded read-only probe capture and owned process cleanup |
| `detect.rs` | Nine allowlisted CLI providers on PATH or fixed user install locations |
| `dictation.rs` | native macOS dictation (bounded `AVAudioEngine` capture to a private temp file, on-stop macOS 26 `DictationTranscriber`; no live events) |
| `agent.rs` | provider argv, bounded fallback conversation context, spawn, stream, cancel |
| `codex.rs` | typed app-server turns, shared bounded native wire/monitor, exact native resume and scoped approvals/input |
| `claude.rs` | native stream-json turns, exact session resume, original-input tool approvals and interruption |
| `opencode.rs` | native ACP turns, exact session load, offered model config and one-shot file approvals |
| `agent_output.rs` | native provider output normalization |
| `turn_review.rs` | bounded native before/after workspace observations, retained historical turn diffs and owner-bound Keep acknowledgments; no rollback or staging |
| `activity.rs` | bounded read-only per-response tool/child observations, native timing/pause/finality and interrupted restart recovery |
| `provider_models.rs` | bounded CLI catalog discovery and documented aliases |
| `provider_usage.rs` | fixed quota probes, memory-only cache, once-only confirmed earned Codex resets |
| `provider_usage_http.rs` | owner-authorized Cursor/OpenCode Go credential reads and fixed read-only HTTPS quota/account endpoints |
| `provider_updates.rs` | fixed npm-registry version checks and explicit `npm install -g` updates for allowlisted provider CLIs |
| `provider_accounts.rs` | private Codex/Claude profiles, fixed vendor login/cancel, metadata and new-session defaults |
| `execution.rs` | catalog-validated effort/Fast/planning, typed per-turn approval profiles and Codex preferences |
| `attachments.rs` | owner-bound IDs, bounded file snapshots, typed image/file input blocks and cache lifetime |
| `window_attachment.rs` | explicit macOS 14+ native single-window selection, bounded JPEG capture and generation-bound picker cleanup; no renderer window identities or control |
| `goals.rs` | bounded persisted Session objectives quoted into user-requested process prompts; no automatic continuation |
| `document_preview.rs` | owner/ID-bound read-only PDF bytes and bounded DOCX/XLSX/CSV content; no extraction, external resources or formula execution |
| `browser.rs` | native macOS embedded browser: per-session WKWebView tabs on the main thread, allowlisted navigation (http/https/blank), cancelled downloads, Safari user agent, favicons, fixed in-page element annotations, bounds-driven placement with DOM-overlay occlusion, `browser-state` events |
| `computer.rs` | native computer use: bounded Accessibility observe/press/value on one worker thread, `CGEventPostToPid` input, ScreenCaptureKit window JPEGs, background app launch, Liquid Glass control pill + window border, physical Escape monitor |
| `computer_mcp.rs` | computer-use MCP bridge (`--mcp-computer`): Settings switch, fixed blocklist, per-session app approval, planning read-only, Escape/Stop revoke, memory-only history, closed `computer_action` |
| `mcp_stdio.rs` | shared stdio child mode for app-hosted MCP servers (browser, computer) |
| `browser_mcp.rs` | agent browser tools: private 0600 Unix socket with per-session constant-time tokens, `--mcp-browser` stdio MCP child mode, fixed bounded tools, human-input interruption |
| `attachment_platform.rs` | native combined macOS picker, once-only Command-V admission and fixed pasteboard reads |
| `pty_term.rs` | PTY (`$SHELL` only) |
| `error.rs` | `{ code, message }` for IPC |

### Frontend (`src/`)

| Path | Role |
| --- | --- |
| `client/` | Types, client and transport; native output is already normalized |
| `store/app-store.ts` | Projects, sessions, layout, bootstrap, realtime binding |
| `primitives/` | InteractiveButton, IconButton, SidebarItem, Surface, Tooltip, Popover, Dropdown, StatusIndicator, ShortcutHint, ResizeHandle |
| `components/` | Sidebar, SessionPane, SessionBoard (Kanban overview with one column per project; a column title opens the lifecycle board), AgentComposer (native dictation mic next to Send, pending handoff card), HandoffCard, MessageActions (copy, handoff picker, pin), BrowserPanel (per-session native browser pane), CommandPalette, EnvironmentPanel (header card), RightDock (launcher + pane tabs: Terminal/Files with inline tree+editor split/Browser/Changes and hidden Editor tabs), FileTree (per-extension and per-folder icons), DiffViewer, TerminalPanel (split workspace with per-region headers), EditorPane, ProviderUpdateToast, Settings, dialogs |
| `lib/shortcuts.ts` | Central keybinding matcher — do not scatter `window` listeners |
| `styles/index.css` | Design tokens and motion tokens |

---

## Domain (as implemented)

- **Project** — user-added folder. `remove_project` drops metadata and sessions, **not** files on disk.
- **Session** — `idle | starting | running | waiting | completed | failed | stopped`. Owns `agent` (provider), optional `model` (CLI model id), `worktree`, `messages`, `lastError`, and last-admitted `execution` preferences (effort/Fast/planning/approval). Codex, Claude and OpenCode persist an exact `nativeThread` bound to session/project/canonical cwd/model; `pendingRequests` are live-generation-only and are never restored from disk. A coordinator may own a `team` (plan, tasks, merge state) and its helper sessions carry `teamWorker`.

**Team** (ADR-043) is a one-shot `+` → Equipe composer mode. The coordinator runs a read-only planning turn and returns at most 3 validated tasks, each with an assignee, planned paths and an optional earlier dependency. Nothing runs before the person confirms; edits are limited to titles, assignees and removing tasks. Each task becomes a normal session in its own isolated worktree. The worktree starts from a private snapshot commit of the coordinator checkout as it is now (uncommitted and untracked non-ignored files included; the person's index and files untouched), and each task runs using the person's Ask/Auto policy (never Full). Approvals stay with the person. A dependent starts only after its prerequisite succeeds. "Merge all" is explicit:

- it applies each finished task to the coordinator working copy in plan order, with no commits;
- before applying, it checks planned paths, then runs `git apply --check` against the current files;
- it stops at the first conflict without applying that task, offering skip, merge anyway (only for out-of-area changes) or Resolve with AI (only for conflicts). Resolve three-way-merges the current checkout snapshot into the helper's own worktree; leftover conflicts go back to that helper for one turn. Patches that still contain conflict markers are refused.

Cleanup of helper worktrees is confirmed. Helpers nest under the coordinator in the sidebar.
- **GitWorktree inventory** — real porcelain `-z` entries with path, HEAD, branch, detached/bare state, lock and prunable reasons.
- **Worktree** — `{ path, branch, isolated }`. Isolated trees live under app-data `worktrees/{projectId}/` with branch `switchyard/<slug>-<id>`. Non-isolated uses the project checkout.
- **AgentProviderId** — `codex` | `claude` | `opencode` | `cursor` | `grok` | `antigravity` | `droid` | `pi` | `devin`. Session is an **agent** process; Settings lists **Providers** (the CLIs). Do not name the Settings section “Agents”.
- **Message** — user | agent | system; `streaming` flag. New native assistant responses optionally retain `activity` with per-turn provider/model, native timing and at most 128 observed tools/children. Children render as trail branches with their native time window and up to 20 newest generic steps (400 per turn); no raw arguments/reasoning or child control. See [ADR-035](docs/decisions/ADR-035-native-turn-activity.md).
- **GitStatus / FileChange** — real `git status` / `diff`; never invent clean/dirty.
- **AppSettings** — `defaultAgent`, `defaultModel` (`provider::id`), `modelExecution` (qualified preferences), `openLastProject`, `disabledProviders`, `favoriteModels` (retained `disabledModels` is ignored: every model of an enabled provider is offered), `sidebarCollapsed`, `sidebarProjectOrder`, `sidebarProjectSortOrder`, `sidebarThreadSortOrder`, `pinnedProjectIds`, `pinnedSessionIds`, `archivedSessionIds`, `environmentPanelDefaultOpen`, `showEnvironmentUsage`, `showEnvironmentRepository`, `showEnvironmentEditor`, `showEnvironmentPullRequest`, `showEnvironmentPinned`, `showEnvironmentNotepad`, `showEnvironmentInstructions`, `enableProviderUpdateChecks`, `locale`, `customShortcuts`, `uiFontSize`, `confirmCloseRunning`, `restorePreviousSessions`, `developerLogs`, `computerUseEnabled`, optional `worktreeBasePath`, local display `profile`.

Unsent composer drafts are owner-validated `project:<id>` / `session:<id>` keys in native `AppData`. Edits checkpoint at most every 250 ms, driven by incoming edits; shutdown saves the latest admitted edit. Metadata removal prunes its drafts. Restored content is never sent automatically. Unsent attachment metadata/goal edits/planning/debugging and provider-specific approval selections are memory-only owner-scoped context in the existing store; native selection/paste supplies bounded private file copies (8 files, 10 MiB each, 40 MiB per turn) or shallow folder names. Native clipboard path/image reads require a fresh once-only native Command-V admission matching the pasteboard change count; renderer byte uploads do not resolve paths. An admitted image can be annotated in the viewer; confirming uploads a bounded annotated PNG through that same byte admission, swaps the draft chip in place and releases the unsent original. Sent reference text becomes part of the persisted user message; binary payloads and preview URLs do not. Cache paths, binary fork reconstruction and attachment restoration after restart are unavailable. File-format interpretation still depends on the CLI/model and existing approval policy. See [ADR-012](docs/decisions/ADR-012-composer-execution-and-attachments.md) and [ADR-018](docs/decisions/ADR-018-native-file-and-clipboard-attachments.md).

Environment reference text lives in native `AppData.contextTexts`: `session:<id>` Notepad and `project:<id>` instructions. Values are bounded to 16,384 UTF-16 units / 64 KiB, owner-validated, pruned on metadata removal, and never sent to providers automatically. Edit-driven checkpoints share the draft gate; blur/unmount/retry flush and shutdown persists latest admitted values. The Environment card no longer mounts Pinned messages, Project instructions or Notepad, and General omits their visibility controls. Retained context text, message pins and legacy visibility flags remain compatible and are not deleted. See [ADR-030](docs/decisions/ADR-030-environment-context-references.md).

PR/check snapshots are memory-only and come from session-owned actual Git branch/HEAD and normalized GitHub origin. Fixed `gh api` GET probes use the CLI's own authentication; no app credential reader or GitHub mutations. Native context is rechecked before publishing; partial/truncated checks cannot claim success. General visibility controls mounting, and Refresh is explicit. See [ADR-031](docs/decisions/ADR-031-read-only-pull-request-checks.md).

Shared types: keep Rust `models.rs` and `src/client/types.ts` aligned (`camelCase`).

Newly admitted user messages reserve one transcript viewport for their latest turn, placing the message at the top until output fills the reserve and transfers to end-follow. Manual history scrolling and explicit bookmark jumps remain detached until user navigation, Follow Latest or a new send. The transcript scrollbar is visually hidden while wheel/trackpad/keyboard scrolling remains available. This is local DOM layout, never native execution or persistence. The left transcript trail presents one tick per user request, with request/reply previews, current/visible-turn highlights and keyboard navigation. Selecting a tick detaches follow and jumps to its existing message. The rail scrolls independently for long histories and hides when the chat pane is narrower than 600px; it adds no summaries, IPC or persisted state.

Selecting text within one visible user/assistant message body offers Add to chat through the existing nonmodal popup. The action rechecks the active session/message and appends an editable plain-text blockquote to that session's existing composer draft, then focuses the composer. It preserves other draft text, uses the native 64 KiB UTF-8 draft bound and never sends automatically. Scroll, resize, Escape, outside dismissal and session changes clear the transient selection action. No new IPC, provider permission or transcript metadata is added.

Conversation search is a transient view in the existing store over owned loaded user/assistant messages, including code. Find in conversation (⌘F) and Search all conversations (⇧⌘F) use the centralized customizable command registry and native shortcut validation. Literal case-insensitive matching displays at most 200 occurrences with an explicit additional-results indicator. Results navigate through the existing message jump and detach follow; code expands during search so matches are visible. Search text, highlights and scope never enter persistence or provider context.

Workspace editor writes are explicit Save/Command-S operations. The existing store serializes saves per session/file key across editor views and only advances the captured buffer identity's saved baseline. Pending writes block discard; newer edits remain dirty. CodeMirror styles reuse the existing trusted head style nonce and never relax CSP. See ADR-019.

Files offers New file, New folder and Collapse all, with no search action. Creation opens an inline name field inside the target folder of the tree (Enter creates; Escape or leaving it empty cancels). The target is the selected directory, the selected file's parent, or the workspace root. `create_workspace_entry` derives the owned session root and admits one printable leaf up to 255 UTF-8 bytes; no overwrite, recursive mkdir or rename. Files and folders can be moved to the macOS Trash (recoverable, never a permanent delete) from the row context menu after a red confirmation, through `trash_workspace_entry`. It refuses the root, reserved folders, outside paths and linked parents. Unix descriptor-relative opens refuse linked components and verify identities before admission/publication; non-Unix creation is unavailable. External namespace renames can still race creation, and no automatic rollback is claimed. Created files open through the existing editor; Save remains explicit. See [ADR-044](docs/decisions/ADR-044-explicit-workspace-entry-creation.md).

Live Changes puts the message field (with Generate title inside) and a Commit button on top, then changed files, then collapsible local history. Its menu offers Commit and push, which commits and then opens the usual Push confirmation, and Push. It exposes explicit prepare/unprepare, matching index/worktree diffs, an editable local filename/kind title suggestion, staged-only Commit and confirmed Push. The closed `git_workspace_action` derives session ownership, bounds snapshots to 200 change entries and 50 local commits, and refuses stale index tokens, invalid/linked/bulk paths and incomplete/conflicted preparation. Native Commit checks the whole staged set and refuses files outside a nested workspace even for legacy callers. App-owned index writes are serialized; tokens/config/path checks do not prevent external Git races and failed postchecks never roll back. Rename preparation shows explicit deletion/addition. History draws only observed actual parent edges and never fetches; Load older commits pages 50 rows at a time from the snapshot's own HEAD hash (bounded). This live workflow remains separate from historical turn reviews. See [ADR-045](docs/decisions/ADR-045-explicit-git-index-workflow.md).

The sidebar retains a 52px icon rail while collapsed. The duplicate Projects rail button/panel is omitted; project folders remain under Home. Docking springs the sidebar open and eases it closed, with rows cascading in. Home/Kanban/Archives hover or focus opens a temporary nonmodal content-height panel anchored to that icon (it glides between icons), pointer departure closes after a revision-bound grace period, and its header docks the visible section through existing `sidebarCollapsed` persistence. Hover never changes main selection or launches probes; nested menus/dialogs retain the panel. The Settings gear is a direct action opening the existing full SettingsPage; it never selects or previews a sidebar section. Home retains owned project folders with nested compact icon/title sessions and unique global pins; search and draft filters sit beside the current project title. Session rows omit project/branch/PR metadata; project folders and their hover details remain. Collapsed folders do not mount their rows, and a folder with more than 60 sessions renders only the rows near the visible area (`SidebarWindowedRows`). The activity scope dropdown and redundant Projects heading/add control are omitted. Floating overlay intersections park the native browser even at a narrow viewport edge. With the sidebar collapsed the header shows a project switcher (search, per-project running/waiting status, open-tab count, New project; ⌘⇧P) followed by that project's open session tabs (T1 pills, gliding active highlight, status dots, drag reorder, context menu, Undo toast; ⌘1–⌘9, ⌘⌥←/→). Tabs are a memory-only per-project view over sessions: a project's tabs start as its sessions in sidebar order (up to 12), selecting a session opens its tab, the landing (`+`/⌘N) shows a blank New session tab that the first send turns into the created session's tab, closing a tab never archives or deletes the session, and switching projects restores that project's tabs and last active tab.

Sidebar project/session pins and archives are bounded ID lists in `AppSettings`, normalized against owned metadata on load/save/removal. Pinned sessions render once in a global Pinned section; archived sessions remain native Sessions and are restorable from Archived sessions. Project/session sorting uses closed native modes and real timestamps; pins retain precedence and dragging returns to manual order. Archiving never changes execution, threads, drafts or worktrees. `rename_project` changes only the existing project’s printable display name (1–200 characters), never a filesystem path. See [ADR-029](docs/decisions/ADR-029-sidebar-organization.md).

Session `pinnedMessageIds` are persisted bookmarks, not model memory. `forkOrigin` records a transcript-derived Session's source boundary; existing forks keep copying only native user/assistant history through a settled response, then reconstruct context before a new native thread. The assistant action now starts a **handoff** instead (ADR-028): `handoff_session` creates an idle session in the same project and worktree for the picked provider/model, with an empty transcript and a bounded deterministic recap (`handoff` metadata); the first send wraps the process prompt with that recap once, while the persisted user message keeps the visible text, and `dismiss_handoff` drops the pending card. See [ADR-016](docs/decisions/ADR-016-transcript-forks-and-message-pins.md) and [ADR-028](docs/decisions/ADR-028-turn-handoff-to-another-provider.md).

Codex/Claude named accounts use native-generated private profiles. `Session.providerAccountId` and per-provider `accountBindings` persist profile ownership; changing defaults affects new sessions only. Exact `nativeThread` also binds its profile. Legacy sessions use `default`. Named process, usage and reset probes share the same child-only profile environment; no missing-profile fallback. Profile binding does not prevent external vendor reauthentication. See [ADR-015](docs/decisions/ADR-015-isolated-provider-accounts.md).

The empty landing shows the Switchyard glyph; New thread/⌘N opens this landing for the selected project (the session is created on first send, with the configured workspace default); the landing row picks project (search/New project), workspace (Local/New worktree) and branch (search/current/create), and its orbital background only renders on the empty landing and the New session dialog only appears when no project is selected; provider and error toasts render top-center over the window header. The titlebar cluster also hosts browser-style Back/Forward arrows over a bounded in-memory history of `{ mainView, project, session, settingsPage? }` selections (including settings sections) (⌘[ / ⌘]); entries whose session or project disappeared are resolved to a live fallback when replayed. The header exposes the Environment card and the right-dock toggle. The Environment card is a fixed window: it stays open until the toggle, Escape or an action closes it, it insets the chat column by 312px while the dock is closed (overlaying the dock when open), and the header toggle persists `environmentPanelDefaultOpen`, which also reopens it on startup. The Environment card shows real data only: Changes (opens the dock Changes pane), workspace/worktree path, worktrees, Commit and Push (explicit; staged changes only), Local Servers (bounded http(s) localhost URLs detected from terminal/agent output, never invented), provider Usage, Repository (fixed https GitHub remote only, else opens the folder), Editor view and Open in… (fixed editor allowlist), branch-owned PR/checks. The right dock replaces the old segmented Context panel: it is a full-height column beside the chat (its own top row aligns with the window header and shares the chat surface color), an empty dock lists Terminal, Files, Browser and Changes, panes become tabs (Changes and Editor are reachable from the Environment card and file clicks), and the dock can be collapsed, maximized or resized. Each session owns up to eight terminals (`Terminal 1…N`) in a split workspace: every split region has its own header with tab chips, a `+` for a new tab and region actions (move active tab to its own region, split right, split down, close). Every terminal has an independent PTY; terminal identity is the terminal id, not the session, region or tab id. Files opens in the Editor pane (CodeMirror, UTF-8 text, bounded read/overwrite only for existing files; unsaved changes are confirmed before closing).

---

Settings Profile derives retained owned activity from transcript dates, excluding imported sessions and fork-inherited prefixes. It does not claim lifetime tokens or historical turn attribution; distributions describe current choices in sessions with activity. Local identity is separate from provider accounts. One typed native PNG action handles explicit Copy/Save and three fixed social composers, with full bounded image decoding and native-only destination selection. See [ADR-032](docs/decisions/ADR-032-local-profile-and-activity-export.md).

Appearance offers System, Light and Dark through native radio cards. Dark/Light retain independent sidebar and whole-window glass/opacities; System follows OS changes without polling and selects the resolved palette’s preferences. Retained neutral Translucent migrates to Dark window glass. Started conversation columns share the sidebar material without wallpaper or an extra opaque coat; New thread and pending handoff keep their landing background. CLI usage aligns directly below the composer and follows the same column when Environment/dock panes open. Shared popup material tokens follow palette/glass while header controls and badges stay opaque. UI, code and terminal families are closed IDs with independent bounded sizes; bundled fonts load locally and installed-only choices fall back. Existing `save_settings` applies retained native preferences on the main thread, and `host_info.appearanceSupport` reports macOS glass/Dock support. Transparent WebView backing is macOS-only; other targets remain opaque. Native glass uses fixed optional WindowServer blur with an AppKit fallback. Runtime Dock changes accept only the default or embedded Smoked Glass/White icons, never renderer paths/images, and do not rewrite the signed bundle. No new IPC or capabilities. See [ADR-033](docs/decisions/ADR-033-persisted-appearance-and-native-glass.md).

Session notifications originate only from native fresh request admission and successful settlements. Persisted settings independently select app/system/sound channels, permission/question/completion events and six closed macOS NSSound presets. System banners/sounds default to background-only. One closed `notification_action` handles Status, explicit Request/Test, fixed OS Settings and allowlisted Preview; it accepts no notification text, paths, session IDs or lifecycle input. Native clicks revalidate ownership and never grant approvals. See [ADR-034](docs/decisions/ADR-034-native-session-notifications.md).

Agent skills uses native fixed-root discovery and closed Catalog/Preview `skill_action` calls. `disabledSkills` controls only Switchyard catalog/explicit invocations, never vendor installations or automatic discovery. Leading known `/skill-name` invocations are bounded native snapshots; provider/cwd/account ownership is rechecked before Send, and existing approvals are unchanged. See [ADR-036](docs/decisions/ADR-036-native-agent-skills.md).

The composer suggests enabled skills at a standalone `/` token and owned workspace files at `@`. Arrow keys navigate, Enter/Tab select and Escape dismisses; IME input retains normal composition. Selecting a skill in prose places its invocation at the beginning for native admission. `workspace_files(owner, query)` returns bounded relative names only, deriving the root from a saved project or session worktree and rechecking ownership before publication. Empty/path queries browse one directory; bare names use an on-demand bounded search. File selections insert quoted `@path` text, never upload contents or grant approvals. See [ADR-037](docs/decisions/ADR-037-composer-suggestions.md).

Native settled responses may retain `TurnActivity.review`: bounded before/after workspace observations with historical diffs. Preexisting dirty contents form the baseline; shared local checkouts do not establish writer attribution. The compact summary has Keep/Review and no Undo. Keep is an idempotent owner/message-bound native acknowledgment, never staging, commit or filesystem mutation. Review opens a session/message-bound historical right-dock tab and never substitutes live Git status. The latest 16 nonempty reviews per session retain full bounded diffs; older counts/acknowledgments remain with unavailable diffs. Forks clear inherited review metadata. No restart reconstruction or synthetic historical summary. See [ADR-040](docs/decisions/ADR-040-native-turn-change-review.md).

Historical Review supports transient line selection (gutter, Shift range or text selection) and a comment appended to the owning session's composer. Admission rechecks the active owner, settled message, retained file and exact diff snapshot; expired, binary, missing or stale diffs are refused. Plain quoted lines carry real old/new coordinates, preserve other draft text and share the native 64 KiB draft bound. No automatic send, code write, persistent review annotation or new IPC is added.

Composer planning and Debug are mutually exclusive memory-only modes retained until changed. Debug adds evidence-based investigation instructions without changing permissions. A bounded `Session.goal` is persisted on Send and applies to subsequent user-requested turns; omission retains it and empty text clears it. Explicit Attach window uses an owner-only native macOS 14+ single-window picker and the existing bounded private attachment cache. No renderer window identity, screen stream or control approval is admitted. See [ADR-041](docs/decisions/ADR-041-composer-modes-goals-and-window-attachments.md).

Composer requests explicitly submitted during active work form a memory-only FIFO in the existing store (eight requests per session, 64 KiB each). Each item captures prompt, goal/modes, execution/approval and attachment references. Matching native successful settlement advances the queue once; Stop/failure pauses it until explicit Continue. Edit pauses and changes only pending text, and Cancel releases unused unsent references. Switching views never redirects a queued send. Existing `send_prompt.queuedAfter` is an optional native admission restriction rechecking provider/model/account/worktree and predecessor assistant ID under the session lock; it adds no command or capability. Closing/restarting drops the queue; restored drafts never auto-send. See [ADR-042](docs/decisions/ADR-042-explicit-session-request-queue.md).

## IPC (explicit allowlist)

Document attachment chips open a transient owner-scoped `document` pane in the existing right dock, including project drafts before first send. `attachment_preview(owner, id)` reads only admitted private snapshots and rechecks owner/ID after parsing. Office data renders as escaped text/tables/cells; a local PDF.js worker renders bounded pages. No preview data is persisted, and no path reader, capability or provider permission is added. See [ADR-039](docs/decisions/ADR-039-attachment-document-reader.md).

There is **no** `execute_any_command`. Adding a command is a security review.

Commands: `transcript_action`, `team_action`, `keep_turn_changes`, `computer_action`, `workspace_files`, `skill_action`, `notification_action`, `load_state`, `save_settings`, `save_composer_draft`, `save_context_text`, `add_project`, `remove_project`, `open_project`, `rename_project`, `git_identity`, `git_status`, `git_diff`, `git_workspace_action`, `git_commit`, `git_push`, `project_remote_url`, `session_pull_request`, `list_worktrees`, `list_dir`, `create_workspace_entry`, `trash_workspace_entry`, `detect_agents`, `create_session`, `fork_session`, `handoff_session`, `dismiss_handoff`, `set_message_pinned`, `set_session_agent`, `set_session_model`, `list_provider_models`, `provider_usage`, `consume_codex_reset`, `create_provider_account`, `select_provider_account`, `rename_provider_account`, `login_provider_account`, `cancel_provider_account_login`, `rename_session`, `delete_session`, `send_prompt`, `stop_agent`, `respond_agent_request`, `start_terminal`, `write_terminal`, `resize_terminal`, `stop_terminal`, `host_info`, `probe_provider`, `pick_folder`, `pick_prompt_attachments`, `capture_prompt_window`, `paste_prompt_attachments`, `release_prompt_attachments`, `attachment_preview`, `pick_executable`, `open_path`, `open_external_url`, `detect_editors`, `editor_app_icons`, `open_in_editor`, `read_text_file`, `write_text_file`, `provider_updates`, `update_providers`, `list_branches`, `checkout_branch`, `create_branch`, `dictation_status`, `start_dictation`, `stop_dictation`, `browser_open`, `browser_close`, `browser_state`, `browser_new_tab`, `browser_close_tab`, `browser_select_tab`, `browser_navigate`, `browser_reload`, `browser_back`, `browser_forward`, `browser_set_bounds`, `browser_annotate_start`, `browser_annotate_finish`, `browser_annotate_cancel`, `browser_copy_link`, `browser_capture`, `profile_image_action`.

Events: `computer-state`, `notification-activity`, `notification-open`, `session-updated`, `agent-output`, `agent-exit`, `pty-output`, `pty-exit`, `browser-state`. Rust owns process status, assistant output and persistence. `load_state` sends session metadata with `transcriptLength` and empty `messages`; transcripts load per session through `transcript_action`, and `session-updated` carries only `messages[from..]` with `transcriptWindow` (ADR-048). The renderer keeps the selected, active, queued and view-retained transcripts plus the 8 most recent, and applies deltas only to loaded ones. Output events carry message identity and UTF-16 offsets; stderr is a separate System message excluded from conversation context. PTY events carry `terminalId`; terminals are owner-validated per session and bounded (8 per session). The renderer cannot declare completion or append output.

Capabilities (`src-tauri/capabilities/default.json`): `core:default`, `core:event:default`, `core:window:allow-start-dragging`, `dialog:default`, `opener:default`. Do not add shell/fs frontend plugins.

---

## Agent providers

To add a provider:

1. `AgentProviderId` in Rust **and** TypeScript.
2. `detect.rs` binary name.
3. argv in `agent.rs`.
4. `src/lib/provider-registry.ts` metadata/capabilities and provider asset.
5. Catalog strategy in `provider_models.rs` and stream decoding in `agent_output.rs`.
6. Settings → Providers list (driven by `detect_agents`): one non-navigating row per provider with installed status and the enable switch.

Do not store vendor tokens. Use the CLI’s own login. Owner-authorized named Codex/Claude accounts may start fixed vendor login in a new private profile; never replace the default or a profile already used by sessions, copy tokens or accept auth material through IPC. Login output is discarded, bounded and secret-free; cancel/shutdown kills owned groups. Cursor/OpenCode named login is unavailable. No account removal or logout command. See ADR-015.

Current argv (verify in `agent.rs` before documenting a change):

- Codex: `codex app-server --stdio`; native `initialize` → `thread/start` or exact `thread/resume` → `turn/start`, with validated cwd/model and a typed approval profile. Ask/Auto use workspace-write/on-request with user/auto_review reviewer; explicit Full uses danger-full-access/never. Thread confirmation and per-turn policy writes prevent inherited Full on restrictive follow-ups. Catalog-validated effort/service tier are per-turn; planning uses a read-only turn sandbox and an explicit collaboration preset. Each turn owns a server process; follow-ups resume only the saved, bound thread. Claude and OpenCode use exact native sessions; Cursor/Grok retain bounded textual fallback context.
- Claude Code: `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-mode <manual|auto|bypassPermissions|plan> --permission-prompts host --permission-prompt-tool stdio [--effort=<catalog-level>] --settings <native-fastMode-boolean-json> [--model=<id>] [--resume=<exact-id>]`; native initialize and, for Auto/Full, a fixed acknowledged set_permission_mode before user input over stdin, one owned process per turn. Exact native identity is bound like Codex; no textual replay. Built-in reviewable tool approvals echo only Rust-retained original input. Unsupported tools, AskUserQuestion and secret requests are denied. See [ADR-010](docs/decisions/ADR-010-native-claude-interaction.md).
- OpenCode: `opencode acp --print-logs --log-level ERROR --cwd <cwd>`; native initialize → new/exact load → offered and confirmed model/build-or-plan/reasoning config → fresh stdin textblock prompt. Child-only permission overrides cover global/build/deprecated build mode; planning denies edits at global/build/plan/deprecated mode layers. Ask uses reviewable workspace file allow-once/reject-once and denies shell/network/external-directory tools. Auto allows file edits while retaining those restrictions, and allows `task` delegation only to the built-in `general`/`explore` helpers. Their agent and deprecated mode permissions are pinned to the same Auto policy with further delegation denied, so repository-defined agents stay unreachable. Ask and planning keep `task` denied. Explicit Full uses child-only permission allow globally and in build/plan agent/mode configuration; unsupported host callbacks remain denied. ACP is not an OS sandbox. Final hardened-policy inference is currently limited by the same provider APIError observed in CLI run; no silent fallback bypasses native approvals. OpenCode retries every provider stream error indefinitely, and ACP does not report this. Native code reads only the main agent's error-level `stream error` lines; definitive ones (usage limit, quota, credit, billing, authentication) cancel the turn with the provider's bounded reason. All other log lines are discarded. See [ADR-011](docs/decisions/ADR-011-native-opencode-acp.md).
- Cursor: `cursor-agent` (or `agent` if the path contains `cursor`) `-p --output-format stream-json --sandbox enabled --trust --workspace <cwd> --stream-partial-output --auto-review [--mode plan] [--model <id>] -- <prompt>`
- Grok: `grok --cwd <cwd> --sandbox workspace --output-format streaming-json [--effort <catalog-level>] [--model <id>] -p <prompt>` (documented flags; local runtime unverified). Its prompt is prefixed with `Task:` to avoid an option-like value.

Additional local print adapters use bounded fallback history, never guessed native session IDs: Antigravity `agy` uses stream-json, default permissions and its terminal sandbox; Droid uses `exec --auto low` and read-only defaults for planning; Pi uses JSON mode, no session, no extensions/project resource approval, offline catalog behavior and only built-in read/edit/write tools (read-only for planning); Devin uses local print, Accept Edits, exec-tool sandbox and existing workspace trust. Ask/Full are unavailable in these four adapters; Antigravity exposes vendor policy only. Their catalogs come from CLI output, with no account/quota inference. No new credential reads, login flows or IPC were added. See [ADR-026](docs/decisions/ADR-026-additional-local-cli-providers.md).

Cursor uses the CLI Auto-review classifier with sandbox enabled. Safe file edits passed on CLI 2026.09.28. Explicit Full removes Auto-review, adds fixed `--force` and sets sandbox disabled; restrictive follow-ups restore Auto-review and sandbox enabled. Vendor deny rules still apply. No yolo flag or persistent vendor permission change is used. Manual tool approvals have no verified machine-response protocol in this adapter and must be handled in the vendor CLI. Older versions without `--auto-review` fail explicitly. Capabilities and explanatory UI notes belong in the provider registry.

Codex responses use only typed one-request `accept` / `decline` / `cancel` decisions or bounded answers to native question IDs. Rust binds callback identity to session/process generation/thread/turn, reserves each response once, and rejects stale/duplicate/foreign responses. No generic protocol passthrough, permission amendments, auth operations, persistent grants or secret questions. Unsupported permission/network/stdin/grantRoot requests are denied. Pending file approvals require native proposed paths/diffs. Stop sends native turn interruption with bounded process-group fallback; shutdown kills owned groups. See [ADR-009](docs/decisions/ADR-009-native-codex-interaction.md).

Effort/Fast require the native catalog for the selected provider/model and matching executable override; only typed options are accepted. Cursor discovers known model parameters through initialization-only ACP; its native-retained map forms bounded bracket arguments while Session model IDs remain unchanged. Renderer bracket/option-like model IDs are rejected; legacy exact presets are retained. OpenCode requires offered/confirmed native reasoning configuration. New adapters expose no unverified effort/Fast controls. Grok effort requires a detected CLI flag and the adapter's documented model table. See the [provider execution guide](docs/development/provider-execution.md). Claude Fast also requires initialization confirmation before input. Composer approval choices select typed native per-turn profiles where verified; unavailable modes stay disabled. Selections are memory-only per owner/provider; model defaults cannot store approval grants. Full is orange and cannot combine with planning. Enabling planning replaces remembered Full, rather than restoring it after Send. See [ADR-017](docs/decisions/ADR-017-per-turn-approval-profiles.md). No vendor account/payment configuration is modified. See [ADR-012](docs/decisions/ADR-012-composer-execution-and-attachments.md).

Only explicit typed Full may select Claude `bypassPermissions`, Codex danger-full-access, Cursor force/disabled sandbox or OpenCode child permission allow. No renderer-generated flags/config, no `--dangerously-*`, no OpenCode `--auto`. Provider sandbox guarantees differ; do not claim filesystem isolation stronger than the CLI enforces. See [runtime guide](docs/development/runtime.md).

Codex, Claude and OpenCode sessions may use the embedded browser as a tool: the app hosts the pages and a private Unix socket bridge, and each provider CLI spawns this same binary in `--mcp-browser` mode (stdio MCP) configured by the adapter with a per-session token. Tools are fixed and bounded (`browser_status/tabs/open/navigate/back/forward/reload/screenshot/snapshot/click/type/scroll/logs/close`); navigation stays on the http(s) allowlist, downloads/uploads stay unavailable, page arguments cross as data, and mutating tools abort when the person used the page in the last 1.5 s. See [ADR-029](docs/decisions/ADR-029-embedded-browser-native-wkwebview.md) and [ADR-030](docs/decisions/ADR-030-browser-agent-mcp-bridge.md).

Computer use (ADR-038) is off by default. When `computerUseEnabled` is on, Codex/Claude/OpenCode turns receive the app-owned `switchyard_computer` MCP server (nine fixed tools, actions return the settled observation). Every app needs an in-session approval per session (memory-only); password managers, Keychain, System Settings, terminals, automation tools and Switchyard are always blocked; planning is read-only; physical Escape or the floating pill's Stop revokes all grants. Input is Accessibility-first and posted to the target process; only `computer_focus` brings an app forward, after 1.5 s without human input. Accessibility and Screen Recording are requested only through fixed native prompts/panes.

Quota reads use Codex app-server and Claude's experimental native `get_usage`, without inference. The owner authorized a narrow credential-reading exception for Cursor and OpenCode Go: Rust reads only the existing Cursor CLI access token (one exact Keychain item on macOS; the CLI auth file elsewhere) and the existing `opencode-go` API key. Three fixed HTTPS GET endpoints return quota/account metadata; redirects, retries, proxies, browser-cookie/SQLite readers, credential enumeration and login/token refresh are unavailable. No renderer-selected URL, headers, auth data or file paths. Raw credentials/responses never cross IPC, logs or persistence. Account email/name/plan and a short non-secret key fingerprint may be displayed; Go exposes no email. HTTP cache entries bind executable and native credential digest, revalidated before publishing. See [ADR-014](docs/decisions/ADR-014-scoped-authenticated-quota-reads.md).

Provider CLI update checks cover only Codex (`@openai/codex`), Claude (`@anthropic-ai/claude-code`) and OpenCode (`opencode-ai`) npm versions; Cursor/Grok stay unchecked. npm-managed installs update through fixed npm argv and a natively installed Claude Code through its own `update` subcommand; anything else reports `updateSupported: false` with a manual-update note. `AppSettings.enableProviderUpdateChecks` gates the check, the persistent toast offers Review updates and Update all, and updates are always an explicit user action. See [ADR-020](docs/decisions/ADR-020-provider-cli-update-checks.md).

`AppSettings.usageProviders` persists footer visibility; snapshots, account metadata and offers remain memory-only. No polling. `consume_codex_reset` is the sole account-consumption exception: an explicitly confirmed, short-lived native offer, freshly matched CLI account email and named credit, once-only reservation and UUID idempotency key. No purchases, overage, plan/config/auth changes or automatic redemption/retries. Reset lifecycle rules remain in [ADR-013](docs/decisions/ADR-013-provider-usage-and-earned-resets.md).

---

## Worktrees and Git

- Isolated worktrees: [ADR-004](docs/decisions/ADR-004-git-argv-no-destructive-defaults.md).
- **Never** automatically: `reset --hard`, `clean -fd`, `worktree remove --force`, force-push.
- Delete isolated worktree only with `confirm: true`.
- Commit and Push are explicit user actions. Commit stages nothing by itself (existing staged changes only) and Push never forces. Hooks/filters guards apply to both.
- Session always knows project, branch, worktree path, agent.

---

## Security

Treat project contents as untrusted.

- Canonicalize paths. Isolated session cwd is the worktree dir; non-isolated must stay under the project root (`session_cwd` in `commands.rs`).
- No path traversal, no shell strings for Git/agents. Native Git disables filesystem hooks/fsmonitor, refuses configured `hook.*` entries (Git 2.54 ignores hooksPath for those), and refuses affected operations when external checkout filters are configured. Inspectors and operations remove the config-only `GIT_CONFIG` override consistently; hook/filter inspection is names-only, output-bounded and deadline-bounded. These are preflight guards with a concurrent external-config-change limitation, not an OS sandbox. Never silently replace LFS/filter semantics. Automatic fetch remains unavailable until networking and ref import are config-isolated.
- PTY binary is not chosen by the UI ([ADR-007](docs/decisions/ADR-007-pty-is-user-shell-only.md)).
- Branch switch/create are explicit actions (`confirm: true`), validated against real local branches (charset + `check-ref-format`), and reuse the same hooks/filters guards as every other native Git command.
- Push refuses project-local network helpers (`credential.*`, `core.sshCommand`, `core.gitProxy`, `core.askPass`, `remote.*.uploadpack/receivepack/proxy`, `url.*.insteadOf`, `http*.proxy`) because they can redirect credentials or connections.
- Editor files: read/overwrite only existing regular files inside the session cwd; `.git` paths are refused; 2 MiB read / 1 MiB write; opens use `O_NOFOLLOW` and re-verify the opened descriptor, and content is truncated only after verification.
- Profile export: closed `profile_image_action` accepts bounded PNG bytes and a fixed action, never renderer paths/URLs. Native PNG save picker and AppKit clipboard only; social actions copy then open three constant composer URLs. No automatic posting or generic `open_external_url` allowlist extension. Bounds and filesystem invariants are in ADR-032.
- External links: http(s) only, no credentials in the URL, fixed host allowlist (`localhost`, `127.0.0.1`, `::1`, `github.com`). The GitHub URL is derived in Rust from `origin`, never rendered by the renderer.
- Provider updates: `provider_updates` reads only `registry.npmjs.org/<fixed first-party package>/latest` (no redirects/retries, bounded body, six-hour memory cache, no polling); `update_providers` requires `confirm: true`, validates ids against the native package map and runs a fixed `npm install -g` argv with bounded output/timeout. No renderer-supplied package, version, URL or flag.
- Provider conversation import was removed (ADR-021 superseded). Previously imported sessions keep `importOrigin` only for compatibility and Profile exclusion.
- CSP in `tauri.conf.json`. Do not load privileged remote content.
- Dictation is native macOS only (ADR-027): one process-wide session, fixed locale pair, bounded 300 s capture into a private temp `.caf`, transcribed once on stop with `DictationTranscriber` (punctuation, short-form) and deleted; `stop_dictation` returns the transcript and there are no `dictation` events; `Info.plist` carries the microphone/speech usage strings; the app binary needs the `/usr/lib/swift` rpath for the Swift bridge. No WebView speech APIs.
- Do not log tokens. Do not auto-run commands suggested by agent output.
- Changes to IPC, FS, PTY, process spawn, or credentials need a security pass before “done”.

---

## Design system

Quiet at rest. Responsive in motion.

Reuse primitives before adding CSS. Arc integration and provenance: [`docs/development/ui-arc.md`](docs/development/ui-arc.md). The HTML declares CSS layer order before shared/lazy chunks. Tokens in `src/styles/index.css` (`--background-0`…`--accent`, `--motion-*`). No random hex, no random durations. Product typography uses the shared `ui-*` role utilities (titles, sections, controls, descriptions, captions, body/chat) in `src/styles/index.css`; role sizes follow `--ui-font-scale`. Do not choose independent font sizes in product components. See the [typography role table](docs/development/ui-arc.md#product-typography).

Launch shows a static splash from `index.html` (tinted glass over the native window backing, metal glyph sheen); `src/lib/app-splash.ts` dismisses it after the first ready paint, flying the logo into the landing glyph when it is on screen and dissolving otherwise. Settings is revealed by a circle from the rail's Settings gear and folds back into it; menu content enters from the direction of travel and the selection highlight glides between items.

Respect `prefers-reduced-motion`, keyboard use, `focus-visible`. Pointer glow stays **on the control**, never `pointermove` on `window`.

The composer's decorative 2 px chrome rim shares the Add button's liquid-metal shader with a bounded 131,072-pixel render budget. It pauses and dims while its textarea is focused, resumes in place on blur, and stops when offscreen, document-hidden, while the window lacks focus or while Settings covers it. The landing orbits and the waiting-approval orbit share the same window-focus/Settings gate (`src/lib/ambient-motion.ts`). Appearance persists its typed `composerLineSpeed` (`slow` by default, `smooth`, `fast`); it follows the existing animations/reduced-motion preferences. This setting changes decoration only, never provider execution speed or permissions.

Native dictation uses a matching metal mic at rest and a silver orbital recording strip with Cancel/Finish while listening. The model/approval/send controls yield to that strip, the rim rests and Send is blocked. Cancel discards the recording; Finish transcribes on-device and appends the result once. There is no live transcription, so the strip's caption stays static while recording. The orbital indicator and illustrative waveform follow animation preferences and pause offscreen/document-hidden; they do not measure audio levels. Changing composer draft owners stops dictation.

---

## Performance

The app may stay open for hours. No polling loops. No global pointer listeners. Lazy `list_dir` — never walk `node_modules`. Agent streaming is events, not timers; the renderer applies `agent-output` deltas once per animation frame. Stream persistence checkpoints are event-driven and coalesced (`persist::checkpoint_soon`: at most one write per second across streams, written outside the state lock; generation-ordered so an older snapshot never replaces a newer save). `state.json` is compact JSON without transcripts; only changed `sessions/<id>.json` files are rewritten (ADR-047). Views that do not read messages use `selectSessionsMeta` / `selectCurrentSessionMeta`; views that need another session's transcript use `useRetainedTranscripts`. Blocking Git/filesystem/worktree commands run on native workers. Measurements and findings: [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md).

---

## Process

### Features

1. This file + relevant ADRs + Graphify if structural.
2. Skills (few).
3. Short plan: modules, IPC, security.
4. Implement on the correct side of the boundary.
5. `npm run typecheck` and `cargo check` (and `npm run build` if frontend-visible).
6. `graphify update .` if structure changed.

Checks include `npm test` (Node built-in runner), `npm run lint` (ESLint bug rules and React hooks), and Rust unit/regression tests. Node 22.18+ is required for the test loader. Tests use disposable fixtures, never user repositories. Run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test` for native changes.

### Bugs

Reproduce, find the flow, Graphify if cross-module, fix the cause, check regressions. No cosmetic hacks over broken Git/agent state. The UI must show real install/git/process status.

### Dependencies

Refuse a new library if the tree already solves it. Weigh Tauri/macOS/size/security. Zustand stays the only client store unless an ADR says otherwise.

---

## Documentation

English under `docs/` and this file. Follow [`docs/documentation-conventions.md`](docs/documentation-conventions.md).

Update this file when architecture, IPC, providers, or conventions change. **Not** a changelog.

---

## Commands

```bash
npm install
npm run tauri dev       # real app
npm run typecheck       # application + test TypeScript
npm run lint
npm test
npm run build           # tsc + vite
npm run build:desktop   # local macOS debug app, ad hoc signature
npm run test:arc        # all 100 free component previews
cd src-tauri && cargo check
graphify update .
```

Persistence: `~/Library/Application Support/com.switchyard.app/state.json` (metadata) and `sessions/<id>.json` (transcripts) on macOS. See [ADR-047](docs/decisions/ADR-047-per-session-transcript-files.md).

Settings persistence runs on native workers. macOS uses a custom native Quit menu item so Command+Q enters the native exit guard rather than predefined NSApp termination. Closing/Quit with native agent handles or Starting admission can require one native confirmation; decline preserves execution. Session reopening controls automatic selection only, preserving all saved sessions/drafts and never starting processes. Developer diagnostics contains fixed aggregate lifecycle counts only, rotating two private 256 KiB files under app data.

Shortcuts (centralized, defaults; custom overrides validated against reserved keys/collisions): ⌘K palette, ⌘N new session, ⌘B sidebar, ⌘, settings, ⌘\ right panel, ⌘` terminal, ⌘[ back, ⌘] forward, ⌘. stop (Escape also stops the selected running agent when focus is in the composer/transcript or nowhere, and no Settings, palette, dialog, menu or Environment card claims it), ⌥⌘O Files, ⌥⌘B Browser, ⌥⌘E Environment. The three workspace commands run only in a selected-session view with Settings, palette and new-session dialogs closed. Settings groups/searches the same closed command registry, edits each command inline in a table (capture field, Save/Cancel, Use default) with page-wide restoration, and saves through existing customShortcuts persistence. Native defaults must stay aligned with src/lib/keybindings.ts; regression checks enforce this contract.

Commit titles use explicit `commit_title_action` Generate/Cancel with session ownership, UUID request and expected whole-index token. Native fixed isolated Codex/Claude requests send only bounded prepared-index excerpts; no renderer prompt, argv, transcript, unstaged contents or automatic provider/account retry. See [ADR-046](docs/decisions/ADR-046-provider-generated-commit-titles.md).
