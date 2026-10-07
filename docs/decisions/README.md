# Architecture Decision Records

An ADR records a decision that was expensive to make, would be expensive to reverse, and whose reasoning is not visible from the source. It answers **why the system is like this**.

These are not a changelog. Overturned decisions get a new ADR; the old one is marked `Superseded by ADR-XXX` and never deleted.

## Index

| ADR | Decision | Status |
| --- | --- | --- |
| [001](ADR-001-tauri-react-not-electron.md) | Desktop shell is Tauri 2 + React/Vite, not Electron or Next.js | Accepted |
| [002](ADR-002-client-transport-boundary.md) | UI talks only to Sirus Code Client API over a Transport | Accepted |
| [003](ADR-003-cli-agent-providers.md) | Agents are host CLIs behind `AgentProviderId`, not embedded SDKs | Accepted |
| [004](ADR-004-git-argv-no-destructive-defaults.md) | Git via argv; no automatic destructive operations | Accepted |
| [005](ADR-005-local-json-persistence.md) | Local-first atomic JSON in app data; no account or cloud | Accepted |
| [006](ADR-006-radix-owned-visuals.md) | Radix for behaviour; Sirus Code-owned visuals, not stock shadcn | Accepted |
| [007](ADR-007-pty-is-user-shell-only.md) | PTY always launches `$SHELL` in the session cwd | Accepted |
| [008](ADR-008-native-session-lifecycle.md) | Rust owns Session execution and transcript state | Accepted |
| [009](ADR-009-native-codex-interaction.md) | Codex app-server interaction stays typed and native-owned | Accepted |
| [010](ADR-010-native-claude-interaction.md) | Claude stream-json approvals and exact resume share typed host authority | Accepted |

| [011](ADR-011-native-opencode-acp.md) | OpenCode ACP exact continuation and once-only native file decisions | Accepted |

- [ADR-012: Typed composer preferences and picker-authorized references](ADR-012-composer-execution-and-attachments.md)
- [ADR-013: Native usage probes and explicit earned-reset redemption](ADR-013-provider-usage-and-earned-resets.md)
- [ADR-014: Scoped authenticated quota reads and account identity](ADR-014-scoped-authenticated-quota-reads.md)
- [ADR-015: Isolated provider accounts with session profile binding](ADR-015-isolated-provider-accounts.md)
- [ADR-016: Native-owned transcript forks and message bookmarks](ADR-016-transcript-forks-and-message-pins.md) (fork entry point superseded by ADR-028)
- [ADR-017: Typed per-turn approval profiles](ADR-017-per-turn-approval-profiles.md)
- [ADR-018: Native file snapshots and explicit clipboard attachments](ADR-018-native-file-and-clipboard-attachments.md)
- [ADR-019: Header environment card, right dock and workspace editors](ADR-019-header-environment-dock-and-editors.md)
- [ADR-020: Provider CLI update checks and explicit npm updates](ADR-020-provider-cli-update-checks.md)
- [ADR-021: Read-only import of Claude Code and Codex conversations](ADR-021-provider-conversation-import.md) (superseded — removed)
- [ADR-022: Explicit branch listing, switch and creation from the new-thread landing](ADR-022-landing-branch-controls.md)
- [ADR-023: Composer dictation through the Web Speech API](ADR-023-composer-dictation.md) (superseded by ADR-024)
- [ADR-024: Dictation removed after a WebView crash; native Speech is the path](ADR-024-dictation-removed-native-path.md)
- [ADR-025: Native macOS dictation (SFSpeechRecognizer + AVAudioEngine)](ADR-025-native-macos-dictation.md) (superseded by ADR-027)
- [ADR-026: Additional local CLI providers with bounded print adapters](ADR-026-additional-local-cli-providers.md)
- [ADR-027: macOS 26 analyzer dictation (file capture, transcript on stop)](ADR-027-macos26-analyzer-dictation.md)
- [ADR-028: Turn-level handoff to another provider](ADR-028-turn-handoff-to-another-provider.md)
- [ADR-029: Embedded browser via native WKWebView, agent tools over local MCP](ADR-029-embedded-browser-native-wkwebview.md)
- [ADR-030: Browser tools for agents over a local MCP bridge](ADR-030-browser-agent-mcp-bridge.md)

- [ADR-029: Sidebar organization as owner-validated settings](ADR-029-sidebar-organization.md)
- [ADR-030: Owner-bound Environment references and bookmark navigation](ADR-030-environment-context-references.md)
- [ADR-031: Branch-owned read-only pull requests and checks](ADR-031-read-only-pull-request-checks.md)

- [ADR-032: Local identity, retained activity and bounded image export](ADR-032-local-profile-and-activity-export.md) — superseded: Profile page removed
- [ADR-033: Persisted appearance and closed native glass controls](ADR-033-persisted-appearance-and-native-glass.md)
- [ADR-034: Native session notifications and closed sound controls](ADR-034-native-session-notifications.md)
- [ADR-035: Bounded native turn activity and read-only child observations](ADR-035-native-turn-activity.md)
- [ADR-036: Native-owned skill discovery and explicit portable invocations](ADR-036-native-agent-skills.md)
- [ADR-037: Composer skill and workspace filename suggestions](ADR-037-composer-suggestions.md)
- [ADR-038: App-owned computer use with per-app approval](ADR-038-native-computer-use.md)
- [ADR-039: Owner-bound document reading in the right dock](ADR-039-attachment-document-reader.md)
- [ADR-040: Bounded native turn change reviews](ADR-040-native-turn-change-review.md)
- [ADR-041: Composer modes, persistent goals and native window attachments](ADR-041-composer-modes-goals-and-window-attachments.md)

- [ADR-042: Explicit per-session request queue](ADR-042-explicit-session-request-queue.md)

- [ADR-044: Explicit empty workspace entries through native ownership](ADR-044-explicit-workspace-entry-creation.md)
- [ADR-045: Explicit index preparation and bounded local Git history](ADR-045-explicit-git-index-workflow.md)
- [ADR-043: Team orchestration is plan-confirmed, worktree-isolated and merged explicitly](ADR-043-team-orchestration.md)

- [ADR-046: Provider-generated commit titles](ADR-046-provider-generated-commit-titles.md) — explicit isolated inference from the owned prepared index.
- [ADR-047: Per-session transcript files with content-addressed writes](ADR-047-per-session-transcript-files.md) — `state.json` keeps metadata; only changed transcripts are rewritten.
- [ADR-048: Transcripts load on demand in the renderer](ADR-048-transcripts-on-demand.md) — metadata-only `load_state`, windowed session events, closed read-only `transcript_action`.
- [ADR-049: Side chats beside a working session](ADR-049-side-chats.md) — one hidden parent-linked session per main session, a fresh recap on each turn, closed `side_chat_action`.
- [ADR-050: Review inbox for pull requests and issues](ADR-050-review-inbox.md) — every owned repository's PRs/issues through `gh`, confirmed GitHub changes, closed `pull_request_action`; sidebar Activity view.
- [ADR-051: Scheduled automations start agent turns](ADR-051-scheduled-automations.md) — owner-removed explicit-Send-only rule for automations: closed schedules, native timer while open, Ask/worktree defaults, closed `automation_action`.
- [ADR-052: Inbox, Tasks and a customizable rail](ADR-052-inbox-tasks-and-rail-customization.md) — derived Inbox, task list with explicit hand-off to an agent (closed `task_action`), rail order/visibility/project shortcuts.
- [ADR-053: Side-by-side conversations](ADR-053-side-by-side-conversations.md) — memory-only pane tree (≤4) where the active pane is the selected session; drag to a pane edge with a lit-half target; no IPC.
- [ADR-054: Global window snap](ADR-054-global-window-snap.md) — opt-in Carbon hotkey snaps the frontmost app window into a nonce-bound native slot; closed `window_snap_action` claim/discard into the open composer.
- [ADR-055: Temporary chats](ADR-055-temporary-chats.md) — landing toggle; the session is deleted once left and settled, worktree kept.
- [ADR-056: Second opinion](ADR-056-second-opinion.md) — another provider/model reviews a settled turn read-only in a same-workspace session opened beside it.
- [ADR-057: Context usage and compaction](ADR-057-context-usage-and-compaction.md) — provider-reported `Session.contextUsage`, composer ring, `/compact` (Codex `thread/compact/start`, Claude native command).
- [ADR-058: Mermaid diagrams](ADR-058-mermaid-diagrams.md) — lazy strict-mode Mermaid with nonce-bound SVG styles in the transcript and Markdown preview.
- [ADR-059: Project folder colour, emoji and logo](ADR-059-project-look.md) — closed `project_look_action` with preset/hex colours, short emoji and a native-picked, bounded 96 px PNG logo.
- [ADR-060: Composer app commands and conversation export](ADR-060-composer-app-commands-and-export.md) — `/review`, `/status`, `/export` and other app commands in the `/` list without shadowing skills; native-picked Markdown export.
- [ADR-061: Undo a turn's changes](ADR-061-undo-turn-changes.md) — per-file `git apply -R` of retained turn diffs after a check; later edits are never overwritten.
- [ADR-062: Steer a running reply](ADR-062-steer-running-replies.md) — Codex `turn/steer` and Claude in-turn input, recorded in place on the reply.
- [ADR-063: Usage-limit notice and resume at reset](ADR-063-usage-limit-notice.md) — provider-reported limits, reset countdown and an explicitly armed continue.
- [ADR-064: CI auto-fix](ADR-064-ci-auto-fix.md) — owner-enabled loop that fixes failing PR checks with an automatic turn, then commits and pushes the session branch.
- [ADR-066: iOS Simulator pane](ADR-066-ios-simulator-pane.md) — live, touchable iOS simulator in the dock through a locally compiled CoreSimulator helper, plus agent tools.
- [ADR-065: Environment Git actions, worktree handoff and stopping servers](ADR-065-environment-git-actions.md) — explicit fast-forward Pull, Create PR, handoff into a new snapshot worktree and stopping only app-started localhost servers.
- [ADR-067: Sirus Code identity](ADR-067-sirus-code-rebrand.md) — name, identifier and mark; no traces of the previous name are kept in code or data.
- [ADR-068: Provider switch motion](ADR-068-provider-switch-motion.md) — picker orbit swap, a 5 s logo-assembly scene per provider on switch, and the handoff card flying into a transcript marker.
- [ADR-069: Astros](ADR-069-astros.md) — persistent assistants on the rail with a cosmic icon, colour, soul, projects and one long conversation.
- [ADR-070: T3-style turn timeline](ADR-070-t3-turn-timeline.md) — reply text and work interleaved in order, sentence groups, live row, "Worked for" fold, skill rows.
- [ADR-071: Smooth replies and reply choices](ADR-071-smooth-replies-and-choices.md) — steady reveal of streamed text; a prose question's options become buttons plus "Other…".
- [ADR-072: HTML in the transcript, image gallery, automatic project icons](ADR-072-html-previews-gallery-auto-icons.md) — agent HTML on an isolated `sirus-preview://` origin, reply image gallery, optional favicon/logo project icons.
- [ADR-073: Prompt recall, stash, plan actions, terminal snippets and Finder drops](ADR-073-composer-recall-stash-plan-terminal-drop.md) — ↑ recall, ⌘S stash, Implement plan, terminal selection chips, folders dropped from Finder.
- [ADR-077: Private secret requests and credential masking](ADR-077-private-secret-requests-and-credential-masking.md) — `request_secret`/`use_secret` with one-use memory-only refs, masked approvals and activity.

## Template

```markdown
# ADR-XXX: Title

**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-YYY

## Context

What problem existed, and what constraints applied.

## Decision

What was decided, stated directly, and where in the code it lives.

## Consequences

- **Positive:**
- **Negative:**
- **Accepted trade-off:**

## Alternatives considered

What else was tried or rejected, and why.
```

## When to write one

Write an ADR when a change constrains future work, is expensive to reverse, or resolved something that was measured or argued about (IPC, agents, Git, persistence, remote). Skip naming, colours, and patch bumps.
