# ADR-099: Native transcripts on demand and dirty-only saves

**Status:** Accepted

## Context

[ADR-047](ADR-047-per-session-transcript-files.md) split transcripts into
`sessions/<id>.json`, and [ADR-048](ADR-048-transcripts-on-demand.md) stopped
sending them to the renderer until opened. The Rust process still read every
transcript at startup and kept all of them in memory for as long as the app ran.
Every synchronous save (settings, drafts, renames, about 29 call sites) also
serialized and hashed every transcript under the state lock, only to find that
most had not changed.

MonoCode keeps transcripts in SQLite and reads one at a time (an index without
the blob column for lists, one row fetch to open a session). Its cross-session
search scans at most 400 sessions.

## Decision

`Session::messages` becomes a `transcript_store::Messages`: loaded, or unloaded
with only its counts in memory.

- **Startup** reads `state.json` only. Sessions that were running at shutdown are
  loaded, because their interrupted turn is recovered (status, activity, streaming
  flags) and saved. All other sessions stay unloaded. The index now records
  `messageCount` and `transcriptLength` per session, so `load_state`, events and
  account checks never read a file to count. A state written before this change
  is counted once at startup and checkpointed.
- **Loading.** Paths that need a transcript lock the state through
  `AppState::data_with_messages(ids)`, which reads the missing files before it
  takes the lock: open (`transcript_action` load), send, retry, stop, fork,
  handoff, side chat parent, turn review keep and undo, CI auto-fix, team planning,
  Astro reports and session tools, documents. Any other access still works,
  because an unloaded transcript reads itself on first access. It is slower,
  under the caller's lock, but never wrong. A transcript read on demand gets the
  recovery a startup load used to apply: stale streaming flags are cleared,
  embedded thumbnails move to files, and the turn's activity is closed.
- **Release.** After a load and after `AppState::persist`, loaded transcripts
  beyond the 6 most recently used are released. Active, waiting or streaming
  sessions, ones with pending requests and ones with unsaved changes are never
  released. Memory pressure releases every idle, saved transcript.
- **Saving.** Each loaded transcript has a revision that changes on every mutable
  access. A save writes the index, then only the loaded transcripts whose revision
  differs from the one last written (still skipping files whose bytes did not
  change). Unloaded transcripts, and ones whose read failed, are never written:
  an empty in-memory view can never replace a file. A save that touches only
  settings, drafts or metadata writes `state.json` alone. Streaming checkpoints
  follow the same rule, limited to the streaming sessions.
- **Scans without the lock.** All-conversations search snapshots the sessions
  under the lock (copying only loaded transcripts) and reads the others one file at
  a time afterwards, without keeping them. It reads the 400 most recently active
  sessions (MonoCode's scan bound) and reports `truncated` when it skipped some.
  The 400 candidate message and 8 MiB bounds stay, because the renderer still
  applies its own 200-hit limit. Thumbnail release on delete, the startup orphan
  sweep and document deletion check unloaded files for the attachment or document
  id as literal text. Any mention keeps the file. The orphan sweep runs on a
  background thread and only considers thumbnails older than the sweep.

## Consequences

- Native memory no longer grows with history: idle transcripts cost their counts.
  Measured with `persist::tests::measure_lazy_transcripts` (see
  `docs/PERFORMANCE.md`).
- A settings or draft save no longer encodes any transcript.
- Opening an unloaded session reads one file (outside the lock).
- A metadata event for an unloaded session carries an empty window at the end of
  the transcript, so a renderer keeps what it holds.
- A transcript that cannot be read stays read-only until it is released and read
  again. Changes made to it meanwhile are not saved, and `transcript_action` load
  fails rather than returning an empty conversation.
- The counts in `state.json` can run ahead of a transcript file between a
  streaming checkpoint and the next full save. Only `transcriptLength` is
  affected until the session loads.

## Alternatives considered

- **SQLite like MonoCode.** Rejected for now: the per-session file layout already
  isolates transcripts, and a storage migration is a larger, separate decision.
- **A private field with accessors instead of `Deref`.** Every site would have
  had to change. Reading on access keeps forgotten paths correct, and the revision
  makes dirtiness automatic rather than something each call site must mark.
- **Explicit dirty marking per call site.** Rejected: a missed mark would lose a
  change once the transcript was released.
