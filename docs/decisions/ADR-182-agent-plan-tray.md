# ADR-182: Agent plan tray above the composer

**Status:** Accepted (2026-10-28).

## Context

Agents keep a to-do plan while they work (Claude `TodoWrite`, Codex `update_plan`, OpenCode
`todowrite`, ACP `plan` updates, Cursor todos). Sirus showed none of it: the activity pipeline
(`activity.rs`) read tool names and targets only, never the plan, so the person had to scroll to guess
where the agent was. Zeron (github.com/zeronsh/comet, MIT; `docs/todo-panel.md`) puts the latest plan in
a tray above the composer. This is the agent's own plan, not user tasks (the Tasks page was removed in
ADR-172).

## Decision

- **One model, the existing pipeline.** Every provider already funnels its stream through
  `activity::{claude, codex, codex_plan, opencode}`. Each now also emits a signal-only `ActivityItem`
  with `plan: Option<Vec<PlanEntry>>` (like the reasoning `thought` signal, ADR-101). `TurnActivity.plan`
  keeps the latest list, replaced wholesale because every provider writes the whole list on each update.
  An empty list clears it. No new event, command or store.
- **Normalized** to `PlanEntry { text, status }` with `status` one of `pending | inProgress |
  completed`, in `plan_entries` / `plan_status` (`activity.rs`). Text is read from `content`, `step`,
  `text`, `title`, `description` or `activeForm`; a status word is accepted in any spelling
  (`in_progress`, `inProgress`, `active`; `completed`, `done`); a boolean `completed` / `done` works when
  there is no status; `cancelled` and anything unknown read as pending.

| Provider | Source |
| --- | --- |
| Claude | `TodoWrite` `input.todos` in the complete assistant message (the streamed block start has no input yet); the main agent only, a subagent's list stays its own |
| Codex | `turn/plan/updated` (`update_plan`) in `codex.rs`; the legacy `todoList` item |
| OpenCode, Cursor, Gemini, Devin (ACP) | `sessionUpdate: "plan"` `entries`; a tool call whose `rawInput.todos` is a list (OpenCode `todowrite`, Cursor todos) |

- Entries are bounded (50 steps, 200 characters), masked by `redact` and scrubbed of the session's
  private secrets before they are kept. The plan persists with the turn's activity.
- **The tray** (`ComposerPlanTray`, mounted in `AgentComposer` above the request queue, so it is on the
  phone too) reads the newest agent message that carries a plan (`latestPlan` in `src/lib/agent-plan.ts`).
  Collapsed it is one line, "3 of 7 · Running tests" (the step in progress, else the first unfinished);
  it opens into the checklist with a check, a pulsing accent dot (still when the turn is not running) and
  a dashed ring. The pulse and the accent follow the app tokens; the list animates in and out and obeys
  reduced motion; on a phone the buttons grow to 40 px.
- **Show and hide** (`planVisible`): hidden with no plan; hidden once every step is done and the turn
  ended; hidden after the person dismisses it, until the plan changes (the dismissal is keyed by the
  list's signature and lives for this run of the app). An unfinished plan stays after the turn ends.

## Consequences

- No parallel pipeline; every provider that already reached `activity.rs` gains the plan with a few
  lines. Providers that only stream text keep no tray.
- A plan the agent clears inside a later turn shows the older turn's plan again until the next one is
  written; accepted for simplicity.
- Zeron's long-list window ("N earlier / N later"), per-chat open state and subagent filtering are not
  copied: the list scrolls (max 14 rem) and the tray opens closed. The design follows Zeron (MIT); no
  code was copied.
