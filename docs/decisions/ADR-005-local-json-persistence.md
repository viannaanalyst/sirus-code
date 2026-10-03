# ADR-005: Local-first atomic JSON persistence

**Status:** Accepted. Storage layout superseded by [ADR-047](ADR-047-per-session-transcript-files.md): compact JSON, with one transcript file per session. Local-first ownership, drafts and the no-telemetry rules are retained.

## Context

V1 has no account, no login, no required server. Projects, sessions, messages, unsent composer drafts, and settings must survive relaunch on one machine.

## Decision

Persist `AppData` as pretty JSON at `{app_data}/state.json` (`~/Library/Application Support/com.switchyard.app/` on macOS). Writes are temp-file + rename (`persist.rs`). Runtime process maps (agents, PTYs) are **not** persisted.

Drafts are native-owned, validated against existing Session/Project IDs, and never sent during restoration. Per-key frontend saves are serialized/coalesced. Native writes use an edit-driven 250 ms leading checkpoint; other state saves and graceful shutdown flush the latest admitted text. This is not a crash-proof journal: edits between checkpoints may remain unsaved while idle. Removing metadata prunes its drafts and rejects late writes.

No telemetry. No cloud database. Do not store CLI tokens.

## Consequences

- **Positive:** inspectable, greppable, no migration framework yet.
- **Negative:** whole-file rewrite; large chat histories will eventually need a better store.
- **Accepted trade-off:** simplicity until history size hurts.

## Alternatives considered

- **SQLite:** better later; not needed at current scale.
- **SwiftData / IndexedDB in the webview:** wrong trust boundary; native core owns the file.
