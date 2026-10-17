# ADR-115: Claude workflows, tab marks, project providers, safer recovery

**Status:** Accepted (2026-10-11)

## Context

The owner chose:
- Claude workflow phases;
- delegation that steps down to a mode the target offers;
- Claude 5.1+ updates shown as text;
- performance fixes;
- providers on or off per project;
- recovery rules and the 10-minute "Starting" limit;
- a setting for conversation tabs;
- a working mark on tabs.

## Decision

- **Claude workflows**.
  - A `task_started` with `task_type: "local_workflow"` becomes a child row named by `workflow_name`.
  - Each `task_progress` carries a full `workflow_progress` snapshot (`workflow_phase`, `workflow_agent`). `workflow.rs` parses it, bounded to 64 phases, 256 agents, 120-character labels and 400-character results.
  - `workflow.rs` merges each snapshot into what is known:
    - phases are only added;
    - a member never moves back (finished to anything else, running to queued) unless a higher `attempt` restarted it;
    - stale attempts are dropped;
    - unknown states read as running.
  - The card shows "Workflow · done/total agents"; open, it lists each phase with its members, state, model and duration. Stop on the card stops the whole run.
  - Workflow tasks keep the turn's process alive like background subagents (ADR-097).
- **Claude 5.1+ progress updates**. These models write updates ("Now I'll read the tests") as a thinking block, which Sirus kept only as the live thought, so they vanished from the reply.
  - The last non-empty thinking block right before a `tool_use` in the same message now joins the reply as its own paragraph.
  - The model check accepts `claude-<family>-<major>[-<minor>]` with major > 5, or 5 and minor ≥ 1.
- **Delegated work steps down**. Work started on someone's behalf (delegation, Astros, habits) uses the inherited approval mode when the target provider offers it. Otherwise it uses the broadest mode the provider offers that is no broader than the inherited one. A provider that takes no mode (Grok, Antigravity) gets none. A target that would need broader access is refused with a clear error.
- **Providers per project**. *Removed on 2026-10-12 at the owner's request: providers are turned on or off only in Settings → Providers, and the "Providers in this project" section, `set_project_provider` and `Project.provider_overrides` are gone (stored overrides are dropped on load). The notes below describe the removed version.*
  - `Project.provider_overrides` turns a provider on or off for one project; `AppData::provider_enabled` resolves the project choice, else the app-wide setting.
  - The rule applies when creating, forking and handing off sessions, and in side chats, tasks, habits, delegation and `sirus_models`.
  - The composer's model picker follows the current project.
  - Edit project has a "Providers in this project" section. A switch saves at once, and a value equal to the app-wide setting clears the override.
- **Safer recovery**.
  - Archived tasks, or tasks under an archived parent, are never continued after a restart (ADR-114).
  - An archived parent is never woken.
  - At startup, results that finished while their parent was busy and were never handed over are delivered.
- **"Starting" limit**. A turn that is still "Starting" ten minutes after it was admitted is stopped and marked failed with a message to send it again.
- **Conversation tabs setting**. Chat behavior → "Conversation tabs" (on by default). Off, the title bar shows only the current conversation's title.
- **Tab marks**. A working session's tab shows three hopping dots in place of the provider icon, a green check when it finished unseen, and an amber dot when it needs the person.
- **Performance**.
  - `SplitWorkspace` is memoized and App's handlers are stable, so opening or closing a panel no longer re-renders the conversation and composer.
  - The team "working" shimmer steps instead of repainting every frame.
  - Link scanning was already linear (1 ms on 50,000 characters), so it is unchanged.

## Consequences

- Workflow members do not get their own transcript views; a running member shows its answer so far and a finished one its result under its row (addendum below).
- The Team coordinator's model catalogue still follows the app-wide provider setting only.

## Addendum (2026-10-17): a running member's answer so far

A running workflow member streams nothing, so Sirus reads its answer so far from its own transcript (after T3 Code). The run's `transcriptDir` comes from the Workflow launch acknowledgement (`tool_use_result`) and the member's `agentId` from the snapshot; the file is `agent-<id>.jsonl`, read only when it resolves to a regular `.jsonl` file inside `<Claude config folder>/projects` (the session account's `CLAUDE_CONFIG_DIR` profile, else the app's `CLAUDE_CONFIG_DIR`, else `~/.claude`). Reads happen only when a `workflow_progress` snapshot arrives: at most once every 10 s per running member and 8 per snapshot, a new attempt starts a fresh window, and reading stops when the member settles or the turn ends. Only the last 64 KiB is read; the latest assistant answer is masked, cut to its last 600 characters and attached as `WorkflowAgent.partial`, live only (never saved) and cleared when the member settles, restarts or the turn ends. The member row shows it as "So far · …"; a finished member shows its result in the same place instead of only on hover.
