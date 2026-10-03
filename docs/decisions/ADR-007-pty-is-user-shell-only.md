# ADR-007: PTY always launches the user shell

**Status:** Accepted

## Context

A terminal is required per Session. If the frontend could pass an arbitrary binary or command line, that is a remote-code-execution API with extra steps.

## Decision

`pty_term.rs` opens a portable-pty and spawns `$SHELL` (fallback `/bin/zsh`) with `cwd` = session worktree, `TERM=xterm-256color`. Frontend may only start/resize/write/stop by `session_id`. xterm.js renders in `TerminalPanel`. Agent processes are a **separate** pipe, not this PTY.

## Consequences

- **Positive:** real terminal; no `execute_any_command`.
- **Negative:** the shell itself is still powerful — mitigated by cwd jail and no binary selection.
- **Accepted trade-off:** a developer tool includes a shell; we constrain *how it is started*, not what the user types.

## Alternatives considered

- **IPC `run(cmd: string)`:** rejected.
- **Reuse agent PTY as the user terminal:** mixes streams and privilege stories.
