# Synara turn review and checkpoint revert

This note is based on the local reference checkout at `../synara`, inspected on
2026-10-02. The screenshots alone do not establish filesystem or provider rollback
semantics. MonoCode is a visual reference for the second preview option; an
equivalent end-of-turn card implementation was not located in its local tree.

## Completed-turn card

Synara retains `turnDiffSummaries` on its thread. `useTurnDiffSummaries.ts` and
`ChatView.tsx:1980` associate the summary with an actual assistant turn and infer
the checkpoint turn count where needed. `MessagesTimeline.tsx:2300` renders a
settled card only when files exist, avoids duplicating the live-change strip,
totals actual line additions/deletions, shows the first five files, and expands
the remaining rows. A missing checkpoint or provider-only diff does not imply
that Undo is available.

## Right-side review

`ChatView.tsx:4853` sends `(turnId, filePath?)` to an existing diff-panel handler,
or navigates to the same thread with `panel=diff`, `diffTurnId` and optional
`diffFilePath`. Review opens the turn; a file row opens that turn at the selected
file. This is a historical turn diff, not an arbitrary current `git diff` against
HEAD. The right panel and conversation remain visible together.

## Undo files and revert conversation are separate operations

- `ChatView.tsx:4029`: **Undo** confirms file-only changes, preserves messages and
  provider conversation history, and dispatches `thread.checkpoint.revert` with
  `scope: files`. A card merging multiple turns undoes them newest-first and
  stops on failure; newer applied file changes can block an earlier undo.
- `ChatView.tsx:2007`: a user message maps to the following assistant checkpoint
  count minus one, so the target is **before that user request**.
- `ChatView.tsx:3979`: **Revert to this message** refuses a live/connecting turn,
  asks for confirmation, and dispatches the same closed command with
  `scope: thread`. Later messages and turn diffs are removed. A fork or a copied
  prompt is not an equivalent rollback.

`apps/server/src/checkpointing/Services/CheckpointStore.ts` exposes bounded
capture, restore, diff and reverse operations. The corresponding Layer captures
working-tree snapshots through a temporary Git index and hidden checkpoint refs,
without making an ordinary user commit. The thread-scope path in
`apps/server/src/orchestration/Layers/CheckpointReactor.ts:1220` validates its
target, captures a rescue snapshot, restores files, rolls back the provider
conversation, and commits the orchestration completion. Failure attempts to
restore the rescue snapshot; an unrepairable failure retains it and reports the
partial state. Stale refs are cleaned up only after successful completion.

## Switchyard boundary and review proposal

Switchyard currently exposes workspace Git status/diff and read-only tool
observations. It has no native turn checkpoint, provider conversation rollback,
or turn-files Undo API. The previews at `previews/changes-review` demonstrate the
card, selected-file right diff, separate confirmation texts and local example
state only. Their six file fixtures supply computed line counts, not user data.

A real implementation must first define native per-session/worktree turn
snapshots, fresh owner and generation checks, bounded retained files/refs,
in-flight/dirty-editor handling, provider-specific rollback support, recovery
and conflict behavior, and explicit destructive confirmations. Unsupported
providers must not offer conversation rollback. Current workspace diff must not
be relabeled as a particular turn's changes.

The actual workspace editor repair is independent: CodeMirror reuses Tauri's
existing style nonce, Save/Command-S is explicit, and the existing store
serializes saves per editor key without replacing newer text or acknowledging
recreated buffers. See [ADR-019](../decisions/ADR-019-header-environment-dock-and-editors.md).
