# ADR-101: Visible subagent replies, a Stop that stops, kept handoffs and the live thought

**Status:** Accepted (2026-10-09)

## Context

Comparing Sirus Code with the latest T3 Code and Synara showed four gaps in how a turn runs:

- **Background subagent replies were folded away.** When background subagents (ADR-097) finished, the Claude CLI's follow-up replies were appended to the same message with nothing marking where each subagent finished. The timeline then folded them behind "Worked for…" (Synara #1497).
- **Stop did not stop everything.** After the person pressed Stop, the PR watch (ADR-079) or CI auto-fix could start a new turn. Sessions the stopped turn had launched (Astro delegation, `sirus_*` tools) kept running (T3 #16002).
- **A failed handoff lost its recap.** `consume_handoff` spent the handoff before the CLI started. If the turn failed before the prompt was delivered, the next turn started on a fresh native thread with no recap (T3 #16287).
- **The live row only said "Thinking…".** Reasoning was dropped entirely (T3 #16284).

## Decision

- **Completion markers.** When a background subagent finishes, `claude.rs` records an activity item with `finishedTask: true` (`label` = its name, `state` = completed, failed or stopped, `offset` = the reply length then).
  - `turn-timeline.ts` treats the reply after each marker as its own answer: only the work before the turn's own answer folds.
  - `AgentActivity` shows the marker as a row, for example "Subagente Auditoria concluído".
- **Stop stops.** `stop_agent` marks the session `stoppedByUserAt` (persisted, cleared on the next send).
  - The PR watch gate and CI auto-fix skip a session stopped by the person until they send again.
  - Stop cascades to still-running sessions this turn launched, and to the ones those launched (bounded to 64).
  - Claude background tasks are interrupted with the turn and marked interrupted.
- **Kept handoff.** The recap stays pending while it is being delivered (`delivering`). `settle_handoff` spends it only when the provider took the prompt (Claude reports it) or the turn completed or produced work. Otherwise it returns to pending for the next send: init timeout, rejected mode, spawn failure, or a stop before the prompt went out.
- **Latest thought.** `activity.rs` keeps the first sentence (at most 140 characters) of the latest reasoning of a running turn as `TurnActivity::thought`.
  - It is live only: it is never written to a transcript file, and it clears when the agent starts answering or the turn ends.
  - The live row reads "Pensando: …" (secrets masked).

## Consequences

- A long background run reads as several answers, one per subagent, instead of one folded block.
- The PR watch and CI auto-fix resume only after the person sends a message in that session again.
- Reasoning is still never stored; only its latest first sentence is shown while the turn runs.
