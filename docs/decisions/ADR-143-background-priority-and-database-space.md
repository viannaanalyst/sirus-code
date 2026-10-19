# ADR-143: Agents run at low priority and the database gives back deleted space

- Status: accepted
- Date: 2026-10-19

## Context

Agents run heavy commands (builds, test suites, installs) next to the app. The provider CLIs used to be reniced by +5 after they started (`process_tree::lower_priority`, ADR-100): a few milliseconds late, so anything they forked first escaped it, only on the exec path, and CPU only — disk-heavy work still made the app and the Mac stutter. Git that Sirus runs by itself (status refreshes, the sidebar's diff stats, the automatic pull) competed with the person the same way.

`state.db` (ADR-114) was created with `auto_vacuum = NONE`: rows deleted when conversations or messages go away became free pages that stayed in the file forever.

## Decision

### Priority

- `process_priority.rs` has one helper, `lower(&mut Command)` (`lower_async` for Tokio): a `pre_exec` hook that raises the child's nice value to at least 10 and, on macOS, sets `setiopolicy_np(IOPOL_TYPE_DISK, IOPOL_SCOPE_PROCESS, IOPOL_THROTTLE)`. It runs in the forked child before exec, so the CLI and everything it starts inherit both. The hook only makes system calls (async-signal-safe: no allocation, no locks) and ignores refusals. No-op off unix; the I/O policy is macOS-only.
- Lowered: every provider CLI (the exec path of `agent.rs`, Claude's native protocol, the Codex app-server, OpenCode and the ACP CLIs), commit-title generation (`commit_title.rs`) and the catalog/version probes of `cli_output.rs`. The post-spawn +5 renice is removed (it also stacked on persistent processes turn after turn).
- Background Git: `git_command` lowers a command built inside `process_priority::background(|| …)`, a thread-local scope. The scope wraps the `git_status` and `project_diff_stats` commands (refreshed on every change and focus) and the automatic pull (ADR-130). Git the person asks for (commit, push, pull, checkout, diffs they open) and the person's terminals keep normal priority.
- No setting: lowering only matters under contention, where the person's own work should win.

### Database space

- `connect` sets `PRAGMA auto_vacuum = INCREMENTAL` before anything else, so a new database is created with it.
- After a save, at most every 30 s (and at the first save after opening), `PRAGMA incremental_vacuum(256)` gives back up to 256 free pages, on the saving thread inside the store's lock, only when `freelist_count` is above zero. The file shrinks at the next WAL checkpoint.
- An older database (`auto_vacuum = NONE`) is converted once at open, before anything is read: `PRAGMA auto_vacuum = INCREMENTAL; VACUUM;`, only when its free pages are at least 16 MiB and a quarter of the file and the disk has twice the file's size free (`statvfs`). The new mode in the file header is the record that it ran; the freed bytes are logged. Below the thresholds nothing happens (the owner's 15 MB database had 1.8 MB free, 12 %), and the check repeats at each launch for a few pragma reads.

## Consequences

- An agent's `cargo build` or `npm install` yields CPU and disk to the app and to what the person runs; it may take a little longer while the Mac is busy, and the same when idle.
- Free pages leave the file a megabyte at a time while the app saves; a large deletion while the app sits idle is given back as saves resume.
- Tests: a child started through `lower` (and its own child) reports nice ≥ 10 from `ps`, a probe child reads `IOPOL_THROTTLE` back on macOS, and only commands built inside a background scope are lowered; with temporary databases, deleted rows shrink a new database through incremental vacuum, a save reclaims at most every 30 s, an old database past the thresholds converts and shrinks, one below them stays as it is.
