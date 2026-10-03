# ADR-042: Explicit queued requests follow native turn settlement

**Status:** Accepted.

## Context

People need to submit follow-up requests while a provider is working, then inspect, edit or cancel the pending requests. A queue must not mix sessions, infer success from assistant prose or turn restored drafts into executable work.

## Decision

- The existing Zustand store holds a memory-only FIFO of at most eight requests per session, each bounded to the native 64 KiB prompt limit. Enqueue is an explicit Send action while the session is starting, running or waiting, or already has pending requests. Empty planning/debug/goal changes alone do not constitute a request.
- Queueing intent and session identity are captured before asynchronous browser context preparation; Stop/failure during preparation keeps the prepared request paused rather than restarting execution. Each request snapshots visible text, the composed reference prompt, execution/approval preferences, goal, modes, attachment metadata and the session's provider/model/account/worktree identity. The text draft clears after enqueue only if it still matches the captured edit. Attachment IDs move into the queue before draft references clear. Removing a pending request releases only attachments unreferenced by other drafts or queued requests; native cache limits still apply.
- A matching native `session-updated` snapshot must settle the observed assistant response successfully before the next queued request is claimed. Claim occurs synchronously before existing `send_prompt` IPC. Duplicate/stale final snapshots cannot dispatch the same item twice. Very fast settlement during the IPC round trip is handled after admission returns.
- Stop pauses the queue before asking native execution to stop. Failed/stopped settlements and admission failures pause it. Continue is explicit; it does not change model, account, workspace or approval choices. Editing pauses the queue, preserves the item's captured context and changes only its text/reference prompt. An attempted request keeps its first predecessor immutable across retries. Ambiguous failed attempts allow retry/cancel, with editing disabled until a delayed native snapshot reconciles admission. In-flight admission cannot be edited or cancelled; the active turn uses existing Stop.
- `SendPromptRequest.queuedAfter` is an optional closed restriction containing the expected provider, model, account, worktree path and predecessor assistant ID. Rust compares it under the existing session admission lock before any turn mutation. It grants no filesystem authority, accepts no executable options and creates no command or capability. The normal native catalog, identity, attachment and approval validations still run.
- A startup/persistence failure after a native assistant response was admitted removes that request rather than replaying its user input. A failure before admission retains the item for explicit retry. Queue processing uses the owned session ID and never selects a view or clears another session's draft.
- Queue state is never serialized. Closing/restarting the app drops queued requests and their transient references. Restored drafts retain the existing no-automatic-send rule. This is finite explicitly requested work, not goal-driven autonomous continuation.

## Consequences

The composer keeps Stop and Add to queue available together. A compact card above it exposes ordered requests, edit/cancel and pause/continue. Captured model/approval and attachment names remain visible. Editing leaves the queue paused until Continue. Native questions/permissions remain generation-bound and require the same existing user decisions.

Deterministic frontend tests exercise ordering, duplicate/stale snapshots, fast completion, selection changes, Stop/failure, snapshot lifetime, request bounds and admitted startup errors. Native tests cover identity/history/active-turn rejection and backward compatibility. These checks do not require paid provider inference.
