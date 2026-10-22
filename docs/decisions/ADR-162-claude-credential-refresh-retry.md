# ADR-162: A Claude turn retries when the shared OAuth credential is mid-refresh

**Status:** Accepted (2026-10-22).

## Context

Claude Code's OAuth access token is single-use: refreshing it rotates it, and the other `claude`
processes that still hold the old token are invalidated. A machine routinely runs several at once —
two Sirus conversations, the usage probe, a terminal — and when the token expires they try to refresh
in the same instant. The loser gives up with `Failed to authenticate: OAuth session expired and could
not be refreshed`, and its turn failed even though the login was fine: the winner had just written the
rotated credential (the Keychain item's modification time moved moments before), so a new process
started right after it worked. It happened intermittently — one conversation failing while another
succeeded at the same time — sometimes several times a day, and a manual "Send again" always fixed it.

A worse outcome of the same race is upstream in Claude Code (`anthropics/claude-code#88583`,
`#84331`, `#101723`): the loser of a refresh sometimes writes its *failed, emptier* state back and
blanks the shared credential — `accessToken`/`refreshToken` empty, `expiresAt: 0` — signing out every
session at once and requiring an interactive `claude auth login --claudeai`. Sirus cannot repair a
blanked credential; it can only retry the transient case and make the broken case actionable.

## Decision

- `claude.rs` recognises the CLI's synthetic `assistant` frame (`is_api_error_message`, `error:
  authentication_failed`) whose text is the refresh race, keeps that text out of the transcript (it is
  the CLI's own report, never a reply) and ends the turn with a `claude_auth_refresh` error.
- `codex.rs` (`monitor`) then starts a fresh Claude process for the same turn, up to twice with a
  1.5 s pause, before reporting a failure: the new process reads the rotated credential from disk or
  the Keychain. The turn keeps its own agent message and its native-thread binding (the session
  snapshot decides `--resume`, so a continuation keeps its thread and a first turn starts clean), and
  the fresh process replaces the old one in `state.agents`, so Stop and the next turn still own the
  right process.
- A continuation's failed attempt persisted the prompt (and the CLI's error) into the native
  transcript. Before retrying, `monitor` truncates that file back to the length recorded just before
  the turn (`account_move::claude_transcript`), so the retry's `--resume` never replays the prompt
  twice. A first turn has no thread yet, so there is nothing to roll back.
- Only the refresh race retries. A revoked or otherwise rejected login (`OAuth token revoked`, …)
  fails at once, so a broken login is never hidden behind retries. When the retries are exhausted and
  the refresh race persists, the turn's error says to sign in again with `claude auth login
  --claudeai` (which is what a blanked credential needs), instead of only the CLI's raw text.

## Consequences

- A turn that lost the refresh race continues by itself; the person no longer sees a spurious "Failed
  to authenticate" that only a manual retry could clear.
- A blanked credential (the upstream corruption) still needs an interactive sign-in; the turn now
  names it. Reducing the number of concurrent `claude` processes — fewer parallel sessions, no
  terminal or other app signed into the same login — lowers how often the race and the corruption
  happen, but only Claude Code can coordinate the refresh across processes.
- Sirus reads, copies and writes no credential: the CLI still owns the login, and the retry only
  starts a new process. The vendor bug (uncoordinated rotation across processes) stays theirs.
- Sirus truncates only the failed turn's own appended lines from the session's Claude transcript,
  never the credential store, and only after the failed process has exited.
