# Architecture Decision Records

An ADR records a decision that was expensive to make, would be expensive to reverse, and whose reasoning is not visible from the source. It answers **why the system is like this**.

These are not a changelog. Overturned decisions get a new ADR; the old one is marked `Superseded by ADR-XXX` and never deleted.

## Index

| ADR | Decision | Status |
| --- | --- | --- |
| [001](ADR-001-tauri-react-not-electron.md) | Desktop shell is Tauri 2 + React/Vite, not Electron or Next.js | Accepted |
| [002](ADR-002-client-transport-boundary.md) | UI talks only to Switchyard Client API over a Transport | Accepted |
| [003](ADR-003-cli-agent-providers.md) | Agents are host CLIs behind `AgentProviderId`, not embedded SDKs | Accepted |
| [004](ADR-004-git-argv-no-destructive-defaults.md) | Git via argv; no automatic destructive operations | Accepted |
| [005](ADR-005-local-json-persistence.md) | Local-first atomic JSON in app data; no account or cloud | Accepted |
| [006](ADR-006-radix-owned-visuals.md) | Radix for behaviour; Switchyard-owned visuals, not stock shadcn | Accepted |
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

- [ADR-032: Local identity, retained activity and bounded image export](ADR-032-local-profile-and-activity-export.md)
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
