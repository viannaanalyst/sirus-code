# Feature backlog

Competitive evidence reviewed on **2026-09-30** to support the overnight MVP mission. This is a source-backed backlog; the implementation status below was updated on 2026-10-01. Track actual implementation and validation in [OVERNIGHT_PROGRESS.md](OVERNIGHT_PROGRESS.md). The [project contract](../AGENTS.md) and accepted ADRs remain authoritative.

## Evidence and scope

Only official product pages, repositories, and maintainer documentation were used. Features below are documented by their maintainers; the competing applications were **not** installed or exercised. Performance claims and marketing demonstrations are not benchmarks. Repository `main` may describe capabilities ahead of a stable release.

| Product | Verified identity and documented behavior | Lesson for Switchyard |
| --- | --- | --- |
| Synara | Its repository distinguishes project, thread, provider session, and workspace tools. It documents provider/model choice per task, managed worktrees for parallel changes, terminal and diff surfaces, and provider handoffs. [Official repository](https://github.com/Emanuele-web04/synara) | Preserve ownership of every task's checkout and keep execution adjacent to review. |
| MonoCode | This research refers to `hardbeat920/monocode`, the desktop coding-agent UI, rather than unrelated educational products with the same name. Its README documents sessions with provider, model, and checkout/worktree selection; its optional operator interface can create unsent drafts. [Official repository](https://github.com/hardbeat920/monocode) | Make the session destination explicit before execution; a draft must remain distinct from a running task. |
| Paseo | The repository documents a daemon managing agent lifecycles behind desktop, mobile, web, and CLI clients. Agent runtimes use the host environment and existing CLI authentication. It also documents trusted plugins and cross-device access. [Official repository](https://github.com/getpaseo/paseo) | Keep the client/core boundary stable. Remote access and trusted plugin execution expand scope and remain outside this MVP. |
| T3 Code | The official site documents using existing provider subscriptions and reviewing changes before GitHub delivery. Its repository documents an agent control surface with several provider runtimes. [Official site](https://t3.codes/), [official repository](https://github.com/pingdotgg/t3code) | Make local diff inspection easy before considering publishing workflows. |

Additional useful evidence:

- MonoCode's changelog reports fixes for saved models changing while catalogs load, transcript scroll jumping during updates, hidden-sidebar subscription churn, and credential refresh races. These are concrete regression scenarios to assess in Switchyard, not evidence that Switchyard already has these bugs. [Maintainer changelog](https://github.com/hardbeat920/monocode/blob/main/CHANGELOG.md)
- T3 Code documents keyboard navigation in model pickers, workspace shortcuts, and terminal-focus exclusions for shortcuts. [Keybinding reference](https://github.com/pingdotgg/t3code/blob/main/docs/user/keybindings.md)
- T3 Code documents cleanup eligibility checks that exclude active sessions, shared worktrees, and user changes. Switchyard can adopt checks for explicit removal while retaining its stricter prohibition on automatic removal. [Project settings reference](https://github.com/pingdotgg/t3code/blob/main/docs/user/project-settings.md)

## NOW — close the local desktop loop

The priorities and acceptance criteria below are Switchyard proposals inferred from the evidence and the overnight mission. They do not assert feature parity.

| Priority | Proposal | Acceptance criteria | Dependency / guardrail |
| --- | --- | --- | --- |
| P0 | Reliable new-session destination | Before creation, show project, provider/model, and current checkout versus isolated worktree. The created session retains the exact selection. Canceling creates no process. | Existing Session and Worktree domain; Rust validates cwd. |
| P0 | Preserve existing model identity | Async discovery or enable/disable preference changes never replace an existing session's model. A missing or unavailable model is identified clearly; new sessions use enabled, available choices. | Model catalog and saved session state; provider-qualified model keys. |
| P0 | Honest process recovery | Reopening persisted `starting`/`running` sessions without a live owned process marks them interrupted/stopped, preserves messages, and offers a fresh prompt. Never imply provider conversation resume when unsupported. | Persistence and native lifecycle ownership; no automatic agent execution on startup. |
| P0 | Safe worktree lifecycle | Creation, Git status, diff, and terminal use the session's worktree. Explicit removal rejects active processes and dirty worktrees and explains the reason. Metadata removal never deletes a user project directory. | [ADR-004](decisions/ADR-004-git-argv-no-destructive-defaults.md); no force removal. |
| P1 | Readable live transcript | Output appears before process exit. Following the latest output works while at the bottom; scrolling upward keeps the reader's position and exposes a return-to-latest action. Stop and failure retain received output. | Existing event stream; no percentage progress or polling loop. |
| P1 | Fast provider/model navigation | Cached detection does not block Settings opening. Explicit refresh shows pending/error states. Favorites and model search include provider identity and remain usable with arrows, Enter, and Escape. | Discovery results must come from actual CLI capabilities or a documented adapter strategy. |
| P1 | Complete keyboard path | Add/open project, create session, choose model/workspace, send/stop, inspect diff, and open terminal work by keyboard. Cmd+B persists sidebar visibility; focus returns to the trigger after overlays close. | Central shortcut matcher; terminal input must retain its own editing shortcuts. |
| P1 | Review at the session boundary | Changed-file list and diff identify the active session path/branch. Refresh on relevant lifecycle/user events; selecting another session cannot retain another worktree's stale result. | Git CLI argv, request identity checks, no aggressive polling. |
| P1 | Clear provider limitation states | Installation, execution failure, unavailable catalog, and unsupported capability have distinct messages. A missing catalog never presents invented model availability. | Existing CLI authentication remains outside Switchyard. |

## Current implementation status

The NOW session destination, model identity, recovery, safe removal, transcript following, catalog navigation, keyboard source paths and Session-scoped Git review are implemented and regression-tested. Actual native edits passed for Codex/Claude/OpenCode and Cursor Auto-review with sandbox enabled. Codex and Claude also passed exact vendor-native follow-ups and host approval refusal. OpenCode ACP now has exact bound continuation and native once-only edit approvals; initial-policy live fixtures passed, while final hardened-policy inference is unverified due APIError also seen with CLI run. Actual desktop fixtures cover palette/sidebar, session/worktree creation, Settings focus, PTY input/resize/close/reopen, Git/diff and Claude Write approval/follow-up. Exhaustive gesture/platform coverage remains unverified.

Per-session/project drafts now persist in owner-validated native JSON and survive graceful restart without being sent. Settings focus is contained in the existing Radix Dialog scope. Manual workspace inventory is implemented with real path/branch/HEAD/lock/prunable data and referencing Sessions; destructive actions remain explicit Session deletion, never retention cleanup.

## NEXT — after the MVP loop is validated

| Proposal | Benefit and minimum condition |
| --- | --- |
| Session search and status filters | Find running, interrupted, and completed work quickly using local metadata. No filesystem indexing is required. |
| Session recap/export | Export a user-requested local recap with provider, model, worktree, messages, and validation notes. Output must identify omissions and must not claim an agent's self-report is a passed check. |
| Extend provider-native continuation | Codex and Claude exact bound continuation are implemented and tested. OpenCode ACP negotiation, exact resume and once-only permissions are implemented; repeat final hardened-policy live acceptance when the shared provider APIError clears. Cursor lacks a verified machine approval response protocol; Grok requires vendor login. |
| Provider-reported turn metadata | Show token usage or runtime activity only when emitted by the adapter. Missing metrics stay absent; no estimated billing or fabricated progress. |
| User-reviewed handoff draft | Prepare a bounded context draft from a session for a different provider, with workspace identity and review first. Sending and actual continuation remain explicit actions. |
| Workspace inventory refinements | Inventory and linked Sessions are implemented. Any additional removal surface must preserve dirty/active checks and explicit confirmation. |

## LATER — separate scope and security decisions

Remote/mobile transport, provider plugins, agent-controlled orchestration, browser automation, external issue inboxes, scheduled runs, and commit/push/PR delivery all require separate design and security review. Competitor documentation makes these interesting future directions; it does not justify importing their privilege model into the current Tauri app.

Do not implement these during the overnight mission: no RemoteTransport, mobile host, secret storage, paid cloud, automated Git cleanup, automatic publication, or broad command-execution IPC. Keep [ADR-002](decisions/ADR-002-client-transport-boundary.md), [ADR-003](decisions/ADR-003-cli-agent-providers.md), and [ADR-007](decisions/ADR-007-pty-is-user-shell-only.md) intact.

## Evidence limitations

- No competitor runtime, authentication, throughput, accessibility, or security behavior was tested.
- No code or brand asset was copied from competing applications. Official provider assets need their own provenance check.
- The backlog ranks engineering value for Switchyard; it does not rank competitors or infer unsupported CLI behavior from their integrations.
- Recheck upstream documentation before implementing a runtime-specific protocol. The local adapter and installed CLI remain the source of truth for actual availability.
