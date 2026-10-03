# ADR-048: Transcripts load on demand in the renderer

**Status:** Accepted

## Context

After [ADR-047](ADR-047-per-session-transcript-files.md) the disk layout was per
session, but `load_state` still sent every transcript to the webview, and every
`session-updated` event re-sent the whole session with all its messages, under
the state lock. The renderer kept every conversation in memory for as long as
the app stayed open.

Comparable tools load conversations when opened:

- **MonoCode:** lists sessions through an index that excludes the transcript column.
- **Synara:** pages messages from a "newest first" index.
- **Codex CLI and Claude Code:** read only the session being resumed.

## Decision

`load_state` returns metadata only. Every session keeps `messages: []` (so the
shared `Session` shape holds) and gains a native `transcriptLength`: the count
of user and assistant messages. Native memory and persistence are unchanged.

One closed, read-only command, `transcript_action`, is added:

| Action | Input | Returns |
| --- | --- | --- |
| `load` | `sessionId` | That session's full transcript. Unknown IDs fail. |
| `search` | `query`, 1–256 characters | Candidate user/assistant messages from owned sessions that contain the query (case-insensitive literal; never a regex). Bounded to 400 messages and 8 MiB, with `truncated`. |
| `activity` | none | Owned user prompt IDs and times after any fork-inherited prefix, deduplicated. |

Search and activity scan a snapshot cloned under the lock, so a long scan never holds it. The renderer keeps its exact matching, offsets and limits for both scopes, and Profile keeps its local-time statistics. Inputs never name paths, and the outputs are transcript data the renderer already received before this change.

`session-updated` carries `messages[from..]` and
`transcriptWindow: { from, total }`. `from` is the current turn (the last user
message) unless an earlier message changed. Keep acknowledgments, for example,
send from the acknowledged message.

The renderer:

- **Loads** the selected transcript before the first paint and loads others when a session is selected, a search result is opened, or a view retains one.
- **Merges** each event by splicing the window into a loaded transcript. An unloaded transcript keeps only metadata. A window that cannot be spliced, or a streamed delta that shows missing text, triggers a reload. Held text that already extends a reloaded snapshot is kept.
- **Applies deltas** only to loaded transcripts.
- **Keeps** the selected, active, queued and retained sessions (team helpers, historical reviews) plus the 8 most recent. Other transcripts are released from memory and keep their `transcriptLength`.

## Consequences

- Startup and webview memory no longer scale with history size, and long sessions are no longer re-sent on every activity change. Measured on 300 sessions × 60 messages (25 MB), native debug build: `load_state` 25 MB → 165 KB, native process 101 → 70 MB, startup CPU 2.0–2.2 → 1.6 s, webview 221 → 199 MB.
- What remains of the webview cost at that size is rendering every session row in the sidebar (about 18 DOM nodes and 125 KB of JS heap per row), not transcripts.
- Opening a session that is not cached needs one IPC round trip.
- All-conversations search depends on the native candidate bounds. The literal case-insensitive prefilter can rarely differ from JavaScript's Unicode case folding.
- Native still keeps every transcript in memory. Moving that to disk is a separate decision.

## Alternatives considered

- **Separate `load_transcript`, `search_transcripts` and `transcript_activity` commands.** Rejected for one closed action, matching `git_workspace_action` and `team_action`.
- **Native-side search with exact JavaScript semantics.** Rejected: the renderer's parsing and offsets drive highlighting, so it stays the single source of match positions.
- **Virtualized paging inside a session.** Deferred: a single transcript is already bounded by per-message limits, and rows use `content-visibility`.
