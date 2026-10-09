# ADR-107: Every long-lived agent kept between turns, and Cursor through ACP

**Status:** Accepted (2026-10-09)

## Context

ADR-106 kept only Codex's app-server between turns: 3 sessions, 10 minutes. T3 Code keeps every provider's process for the conversation and releases it after 30 idle minutes. Cursor ran as a print adapter that could not answer its own permission requests, while T3 runs it through `cursor-agent acp`.

## Decision

- **One pool** (`agent_pool.rs`) for Codex, Claude, OpenCode and the ACP agents (Devin, Hermes, Cursor).
  - A process is kept after a turn that ended cleanly (`Wire::reusable`) for the session's next turn: 30 idle minutes, as T3 does, and at most 8 sessions.
  - Its key holds what was fixed at start:
    - binary, account and profile, workspace;
    - computer use (MCP servers);
    - Claude's permission mode, model, effort and fast mode;
    - OpenCode's permission policy;
    - the native conversation it holds (`with_thread`).
  - A changed key starts a new process.
  - Reuse skips spawning, `initialize` and, for ACP, `session/load`. Modes, models and reasoning are still set and confirmed every turn.
  - These stop the process instead of keeping it: Stop, a failure, an interrupted turn, deleting the session or project, and quitting. A Claude turn in which background tasks ran (ADR-097) is not kept either, so their output can never reach the next turn.
  - OpenCode's log reader outlives its first turn and reports provider errors to whichever turn runs now (`opencode::route_errors`).
- **Cursor through ACP** (`acp_cli.rs`, `cursor-agent acp`).
  - Agent mode, or Plan mode for planning.
  - The model is chosen by its base ID among Cursor's parameterized values; legacy preset IDs fall back to their base.
  - Reasoning (`thought_level`) and `fast` are set as options when the model offers them.
  - Sirus answers Cursor's requests by access mode: Full allows all of them, Auto-review allows file edits and asks before commands, and Request approval asks for every one. Planning never auto-allows.
- **Antigravity stays a print adapter.** T3 runs it through Google's separate Antigravity ACP server (`agy_acp_server`), which T3 downloads and signs in to on its own. The `agy` CLI has no ACP mode, so Sirus keeps `agy` print.

## Consequences

- From the second message on, Codex, Claude, OpenCode, Devin, Hermes and Cursor start their turn on a live process.
- Up to eight idle agent processes may stay in memory for 30 minutes.
- Grok, Antigravity, Droid and Pi still run one process per turn: their CLIs answer one prompt and exit.
