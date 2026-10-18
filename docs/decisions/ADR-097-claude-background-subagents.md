# ADR-097: Claude background subagents keep their turn

**Status:** Accepted

## Context

Sirus runs one `claude` process per turn and stops its process group when the turn ends (`codex::stop_owned`). When Claude launched subagents with `run_in_background: true` and then answered ("I'll wait for the three analyses"), the turn's `result` arrived, Sirus ended the turn, and the subagents died with the process. Their rows showed only a label with no state, and nothing told the person that background work had been lost.

The protocol was recorded with Claude Code 2.1.294 (`-p --input-format stream-json --output-format stream-json --verbose --replay-user-messages`):

- Launching sends the `Agent` tool use with `input.run_in_background: true`, then `system/task_started` with `task_id`, `tool_use_id`, `description`, `subagent_type`, `task_type: "local_agent"` and `is_backgrounded: true`, and `system/background_tasks_changed` listing every running task. The tool result says "Async agent launched successfully" with the agent id.
- The turn's `result` arrives right away and names our prompt in `user_message_uuid(s)`. The child keeps running in the same process and reports `system/task_progress` (with a description of its current step), then `task_updated` (`patch.status`), `task_notification` (`status: completed | failed | stopped`) and `background_tasks_changed` without it.
- The CLI then runs a turn of its own: `system/init`, the main agent's text and a `result` with `origin.kind: "task-notification"` and no prompt uuids. It does not echo a `<task-notification>` user message. `queued_turn_count` reports further queued turns.
- The `stop_task` control request (`task_id`) stops one task; its notification then says `stopped`. `interrupt` stops every background task. Tasks a subagent starts carry `parent_task_id`.

## Decision

- **Turn lifecycle** (`claude.rs`): the turn tracks the main agent's background subagents (`local_agent`, `is_backgrounded`, no parent task). When our prompt's `result` arrives while any runs, the turn keeps its process and wire and stays `running`. Later results close the CLI's own follow-up turns, and their text continues the same reply after a blank line. A task that settles between turns, an instruction sent then, or a `queued_turn_count` above zero means a follow-up turn is expected. The turn ends when no background task runs and no follow-up is expected. A follow-up that never starts is given up after 20 seconds.
- **Limit:** 30 minutes of background silence (`BACKGROUND_LIMIT`; amended 2026-10-17: counted from the last sign of life — a task starting or settling, a follow-up turn beginning — instead of from our first answer, which cut off sessions that kept working through their background tasks). At the limit the turn interrupts the CLI, marks what still runs as stopped with `timedOut`, and ends as answered.
- **Stop:** the Stop button interrupts as before and the process group is stopped. Each row in the strip can stop its task alone through `stop_background_task` (Claude's `stop_task`).
- **Rows:** child rows carry `background: true`; `task_progress` sets their `detail`. A background child still running when its turn ends for any reason (stop, failure, app quit, restart recovery) becomes `stopped`. `timedOut` marks the limit. Both fields are optional in JSON, so older sessions load.
- **UI:** an "In the background" strip on the composer's top edge (like reply choices) lists the running ones with a pulsing dot, name, current step, time (its own one-second clock while shown) and a stop per task. Timeline rows say "Running for 2m", "Finished in 3m 10s", "Failed", "Interrupted" or "Stopped at the time limit" with an icon and colour. The reply header shows "2 in the background" while they run, and "2 interrupted" afterwards; on the latest reply, Resume sends a follow-up asking Claude to run them again.
- **Cards (2026-10-08):** in the timeline a background subagent uses the same card as any subagent (ADR-070): a lightning icon, the title, "Subagente em segundo plano · <current step>", time and steps, and a pill "Em execução", "Concluído", "Falhou", "Interrompido" or "Interrompido no limite de tempo". The elapsed time moved out of the state words ("Em execução há 2m") into the muted text beside the pill; the strip above the composer is unchanged.

- **Background shells (2026-10-13):** a `Bash` call with `run_in_background` from the main agent now holds the turn the same way. Claude Code 2.1.296 reports it like a subagent (`task_started` with `task_type: "local_bash"` and `is_backgrounded: true`, then `task_notification`) and runs a turn of its own when it ends, which used to happen unseen in the kept process while the session looked finished ("I'll wait for the deletion to finish"). Its row carries `shell: true`; it shows in the strip with its stop and in the reply header count, but not as a card in the timeline, where its `Bash` call is already a row. Its marker reads "Command … finished". A dev server left running ends at the 30-minute limit, like an idle kept process (`POOL_IDLE`).

## Consequences

- A session stays `running` while its background subagents work, so the Working panel, notifications and the Astros habit watchdog count that time as work.
- Typing while background work runs steers, as in any running turn; the instruction runs as a CLI turn of its own and its answer continues the reply.
- Tasks started by subagents do not hold the turn; they stop with the process.
- Codex is unchanged: its spawned agents report through `collabAgentToolCall`/`subAgentActivity` inside the turn, and nothing similar was needed for Codex.
- The behaviour depends on the CLI's task frames. If a future CLI stops sending them, turns end at their own `result` as before.

## Alternatives considered

- **A long-lived process per session:** it would also keep background work, but changes the one-owned-process-per-turn model (ADR-010) for every turn.
- **Asking Claude not to use background agents:** loses the parallelism the person asked for.
