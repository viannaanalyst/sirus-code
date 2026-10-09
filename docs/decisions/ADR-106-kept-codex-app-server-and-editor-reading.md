# ADR-106: Codex app-server kept between turns, and editor reading preferences

**Status:** Accepted (2026-10-09); the pool's limits and scope are superseded by ADR-107 (30 minutes, 8 sessions, every long-lived agent).

## Context

- **Codex turns started slowly.** Each Codex turn started a new `codex app-server`, initialized it, started its MCP servers (browser, Sirus tools, computer use), and resumed the thread. T3 Code and MonoCode keep the app-server alive for the conversation.
- **The editor read worse than T3's.**
  - Markdown was almost uncoloured.
  - Only Markdown wrapped, so code lines ran off the pane.
  - Fold chevrons sat beside every line number.
  - The rendered/code choice for Markdown was forgotten with each file.

## Decision

- **Kept app-servers** (`codex.rs` pool).
  - After a Codex turn that completed, its app-server is kept for the session's next turn: at most 3 sessions, 10 minutes idle each.
  - A kept process is reused only while its key is unchanged: binary, account, account profile, workspace, and whether computer use is on. Otherwise it is stopped and a new one starts.
  - The reused process skips `initialize`, but the turn still resumes the thread and checks its approval and sandbox policy, as before.
  - These endings stop the process instead of keeping it: an interrupted or failed turn, Stop, Sirus closing (`clear_pool`), deleting the session, or removing the project.
  - Its stderr reader lives with the process, so the turn does not wait for it.
- **Editor** (after T3):
  - Markdown is coloured like VS Code's themes: headings, strong and emphasis, inline code, quotes, list markers, and the `#`/`**` marks.
  - Word wrap applies to every file and is a preference (on by default), toggled in the pane header.
  - Fold chevrons show only while the pointer is over the gutter, or on a folded block.
  - Rendered or code view for Markdown is a preference that carries to the next file (`editor-preferences.ts`, kept on this Mac).

## Consequences

- From the second message on, a Codex turn starts without spawning Codex or its MCP servers.
- Up to three idle Codex processes may stay in memory for ten minutes.
- A change to Codex's own `config.toml` (for example, its MCP servers) applies to a kept session after its process ends, at most ten minutes later.
