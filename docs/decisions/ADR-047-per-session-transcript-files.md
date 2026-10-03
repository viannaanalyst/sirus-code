# ADR-047: Per-session transcript files with content-addressed writes

**Status:** Accepted

## Context

All state lived in one `state.json`: projects, settings, drafts and every
session's full transcript, including retained turn-review diffs. Every save
encoded and fsynced the whole file. Streaming checkpoints therefore rewrote
every conversation about once per second, even though only one transcript
was changing.

Measured on a synthetic heavy history (release build):

| History | State size | Encode | Decode | Clone |
| --- | --- | --- | --- | --- |
| 300 sessions × 60 messages | 26 MB | 10 ms | 9 ms | 2 ms |
| 600 sessions × 120 messages | 102 MB | 35 ms | 35 ms | 8 ms |

Encoding is cheap; rewriting and fsyncing tens of megabytes per checkpoint is not.

Comparable local tools on the same machine all keep conversations apart from the
index:

- **Codex CLI and Claude Code:** one append-only JSONL file per session.
- **MonoCode:** one SQLite row per session, with the transcript as a JSON blob and a covering index for listing.
- **OpenCode:** SQLite.
- **Synara:** event-sourced SQLite with one row per message (790 MB for 11 threads here), and backups before each schema migration.

None rewrites every conversation on each save.

## Decision

`state.json` keeps projects, settings, drafts, context text and every session's
metadata, without `messages`. Each session's messages live in
`sessions/<id>.json` next to it as `{ "sessionId", "messages" }`, compact JSON.
File names use the session ID when it is 1–128 characters of `[A-Za-z0-9_-]`;
any other ID uses `h-<sha256>` so state content can never choose a path.

Writes are content-addressed:

- Every save encodes each session's messages and keeps a 64-bit hash of what is on disk per file.
- Only files whose hash changed are written (temp file, fsync, rename).
- `state.json` is written after the session files, so a crash leaves at worst an orphan or an older transcript, never a reference to a missing file.
- Files of removed sessions are deleted after `state.json` no longer lists them.
- Generation ordering from Stage 3 applies to the whole set: an older snapshot never replaces newer files.
- The coalesced streaming checkpoint clones the state under the lock and encodes, hashes and writes outside it.

On load, a session entry without `messages` reads its file. A missing file yields
an empty transcript. An unreadable or foreign file is renamed `*.corrupt` and kept,
and loading continues. Orphan transcript files are removed.

A legacy `state.json` (any session entry that still carries `messages`) is
migrated once:

1. It is copied to `state.json.pre-split-backup` first, unless a backup already exists.
2. Every session file is written.
3. `state.json` is rewritten without messages.

Interrupting this is safe: the legacy file stays authoritative until the final rename.

Memory and IPC are unchanged: native `AppData` and `load_state` still carry full transcripts. No command, event, capability or renderer path is added.

## Consequences

- During streaming only the active conversation and the small index are rewritten. The cost now scales with one session, not the whole history.
- `state.json` stays small, so settings, drafts and metadata saves are cheap.
- Each save still encodes and hashes every transcript in memory. That is CPU, not disk, and is bounded by the measurements above.
- A very large single session is still rewritten whole on each checkpoint. Per-session append-only journals (as the CLIs use) would remove that and remain possible later.
- Downgrade: an older build refuses to load the split `state.json` (missing `messages`) instead of overwriting transcripts. The pre-split backup restores the legacy layout manually.
- Loading full transcripts on demand in the renderer (memory and startup) is a separate later step. The metadata-only index is its prerequisite.

## Alternatives considered

- **SQLite (MonoCode, Synara, OpenCode).** Rejected for now: the project rule keeps persistence in JSON, and per-file granularity gives the same write isolation without a new dependency or migration framework.
- **Append-only JSONL per session (Codex, Claude Code).** Deferred. Messages are mutated in place (activity, review acknowledgments, streaming text), so a journal needs replay and compaction rules.
- **Dirty flags at every mutation site.** Rejected: more than fifty call sites, and a missed flag silently loses data. Content hashing is correct by construction.
