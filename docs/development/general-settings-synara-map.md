# General settings: Synara reference map

Inspected the local `../synara` checkout on 2026-10-01. This document maps existing
behavior and the implemented General and Environment reference settings.

## Reference and presentation

Synara's `apps/web/src/routes/_chat.settings.tsx`, `renderGeneralPanel` (lines
517–850), renders Core defaults, Sidebar organization, Sidebar sections,
Environment panel, Code and status, and Context and notes. Safari import setup
and a desktop Beta channel card precede those groups when supported.

`settingsPanelStyles.ts` defines soft, bordered, 12 px cards, faint row dividers,
13 px titles/descriptions through shared typography tokens and density-dependent
row padding. Rows place their label/description on the left and the control on
the right. Modified preferences can expose a per-setting Reset button.
`components/settings/SettingControls.tsx` owns select, segmented and reset controls.
These are presentation references; Sirus Code remains React/Vite/Tauri with its
existing primitives and Client/Transport boundary.

## Feature mapping

| Synara General item | Sirus Code today | Application path |
| --- | --- | --- |
| Default provider | General selector uses the nine-provider registry and existing save action | Installed/enabled options only; affects future sessions, preserves compatible models and clears foreign defaults |
| New threads: Local / New worktree | `defaultSessionWorkspace`: Ask / Current checkout / New worktree; shown in General and Worktrees | Keep the extra Ask option and existing draft/worktree admission |
| Delete worktree on archive | Archiving only changes sidebar metadata; it never deletes files/worktrees or stops execution | Separate native lifecycle design/review required; do not copy automatic deletion into a UI preference |
| Welcome tour | No replayable onboarding tour | Requires an actual tour before exposing a control |
| Sidebar layout: Classic / Rail (beta-gated) | One collapsible project/session sidebar | Optional future layout study; no beta flag or second sidebar state store |
| Project order: updated / created / manual | Implemented through a closed persisted enum; legacy manual order | Real project/session timestamps, pins first; drag/Option+arrow returns to manual and retains the displayed order |
| Thread order: updated / created | Implemented through a closed persisted enum; legacy newest-created order | Real native timestamps; global pins retain their own order |
| Chats section | Every native Session belongs to a Project | No standalone chat section within the current product model |
| Hubs section (feature-gated) | No hubs/groups subsystem | Not a settings-only port |
| Automation run threads | Automations is disabled; there are no run-owned sessions | Requires an automation implementation |
| Environment: Open by default | Implemented as `environmentPanelDefaultOpen`, including startup and last toggle | Already equivalent; retain current behavior |
| Code and status: Usage visibility | Implemented as `showEnvironmentUsage`, true by default | Environment-only; footer and quota authorization remain separate |
| Repository visibility | Implemented as `showEnvironmentRepository`, true by default | Hidden sections skip the metadata probe; native URL validation remains |
| Pull request visibility | Implemented as `showEnvironmentPullRequest`, true by default | Native branch-owned GitHub origin PR/checks with bounded CLI reads, explicit refresh and partial results; review/repair/merge actions are outside scope |
| Editor visibility | Implemented as `showEnvironmentEditor`, true by default | Unmount hidden actions/discovery; native editor authorization remains |
| Recap visibility | Handoff recap exists in session metadata; no general auto-generated Environment recap | Handoff is not equivalent to Synara's recurring recap feature |
| Pinned messages visibility | Implemented as `showEnvironmentPinned`, true by default | Environment resolves real settled assistant bookmarks with jump/unpin actions; completion/rename metadata is outside this scope |
| Project instructions visibility | Implemented as `showEnvironmentInstructions`, true by default | Bounded project-owned local reference text, shared by project sessions; no automatic provider input or checkout-file changes |
| Notepad visibility | Implemented as `showEnvironmentNotepad`, true by default | Bounded per-session reference text with autosave/retry; not copied into forks/handoffs |
| Safari import setup (conditional) | Only Claude/Codex CLI conversation import exists | Browser import is a separate native/security feature |
| Beta channel card (desktop-specific) | No app beta updater or second app/data channel | Do not reuse vendor CLI update checks as an app updater |
| Restore defaults | One General header action; no per-row resets | Existing serialized save restores General preferences only; other pages, manual order, pins and reference text remain intact |

## Sirus Code-specific settings to retain

The current General panel also exposes Language, Reopen last project,
Confirm closing running sessions, Reopen newest session, and an unavailable app
update check. Reopening never starts an agent. Native close/quit authorization
must remain intact. Provider CLI update checks live under Providers and are
independent from app updates.

The existing preference path is `SettingsPanels → SettingsPage.onSave →
app-store.saveSettings → SirusClient.saveSettings → LocalTransport → native
save_settings`. New persisted fields must remain aligned in TypeScript/Rust and
normalize legacy state. See [ADR-019](../decisions/ADR-019-header-environment-dock-and-editors.md)
(Environment), [ADR-005](../decisions/ADR-005-local-json-persistence.md) (persistence)
and [ADR-029](../decisions/ADR-029-sidebar-organization.md) (sidebar organization).
Current native close/quit rules are documented in `AGENTS.md` and implemented in
`src-tauri/src/close.rs`.

## Implemented first stage

Study 3, Orbit, is selected and applied to the shared production switch. General
now includes the provider selector, a page-level reset, typed ordering and three
existing Code and status visibility settings, PR/checks and three Context and notes settings,
backed by native defaults and save/load tests.
Grouped cards follow the reference rhythm using existing host primitives.
Default provider, new-session workspace, language and project/session ordering
use the same compact Arc Select, including its menu and value animations.
Orbit's production palette is satin silver; isolated studies retain
their original illustrative colors.

## Context and notes

The Environment card implements the three mapped reference sections with the
existing Arc Textarea and native ownership/persistence. General has one silver
Orbit switch per section and one General page reset. Hiding a section retains its content.

Synara's `EnvironmentPinnedSection` additionally offers completion/rename;
Sirus Code implements the approved jump/unpin scope over existing bookmarks.
`EnvironmentNotesSection` supplies the per-thread reference behavior, and
`EnvironmentProjectInstructionsSection` supplies the project reference. Copying
or appending instructions into notes is outside this implementation. Neither
reference is injected into model prompts or written to checkout instruction files.
Ownership, bounds and checkpoint/flush behavior live in
[ADR-030](../decisions/ADR-030-environment-context-references.md).

The isolated studies remain illustrative and memory-only. Missing product
features in the table still need their own implementation; the unavailable app
update setting remains explicitly marked as coming soon.

PR/check ownership, GitHub CLI reads and bounded partial results follow
[ADR-031](../decisions/ADR-031-read-only-pull-request-checks.md).
