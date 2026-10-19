# ADR-153: Discard changes per file and for the whole list, with a confirmation

**Status:** Accepted (2026-10-19).

## Context

The Changes pane lists staged and unstaged files and lets the person prepare or unprepare them, but there was no way to throw a change away short of a terminal. VS Code's Source Control offers a discard arrow on each row and a discard-all action in the section header. Git can restore tracked files, but it cannot bring back a file it never tracked, and a discard must never run on a path that escapes the repository.

## Decision

- **One native action.** `git_workspace_action { type: "discard", sessionId, paths[], expectedIndex, confirmDelete }` discards every staged and unstaged change to the listed paths and answers the refreshed snapshot. It runs under the same index lock, token, truncation and conflict checks as preparation, and its plan comes from the snapshot taken under that lock, never from the caller.
- **Plans per path** (`git_workspace::discard_steps`, mirrored by `lib/discard-changes.ts`):
  - a staged new file: `git rm --cached -f -q -- <path>`, then delete the file;
  - a tracked file staged or unstaged (modified or deleted): `git restore --staged -- <path>` when staged, then `git restore --worktree -- <path>`;
  - an untracked file: delete it.
  Renames are not planned as such: status runs with `--no-renames`, so the old path is a deletion and the new path an addition, and each is discarded on its own. A path with a staged deletion and a new untracked file is refused, because restoring would overwrite the new file.
- **Paths are checked natively.** Every path must be a plain relative name (no absolute path, `..`, `.`, `.git`, backslash or control characters), no component may be a symlink or a submodule, and the canonical location must stay inside the workspace (`validate_path`). Git runs with literal pathspecs, and every argv puts `--` directly before the path. Deleting re-checks the path just before removing it.
- **Deleting needs a second confirmation.** Files Git does not hold cannot be restored and the app does not have a Trash crate, so they are not moved to the Trash. Any plan with a deletion needs `confirmDelete: true`, which the dialog sends only after the person confirms. Without it the native side refuses with a message that asks for the deletion to be confirmed.
- **Only visible files.** The header's discard-all acts on the files the list shows, so untracked files hidden by the Git untracked setting are never touched.

## The interface

- **Row.** A discard arrow next to the prepare button, shown on hover or focus like the other row actions, and the same action in the row's right-click menu (`ContextMenu`, destructive group).
- **List header.** A discard-all button beside Refresh in the Changes pane header; it acts on every listed file that is actionable.
- **Confirmation.** The shared `ConfirmDialog` (destructive): "Discard changes to <path>?" or "Discard changes to N files?", "This cannot be undone. Prepared changes are unprepared first.", and a line that names how many new files will be deleted from disk when there are any.
- **Result.** A toast (`ChangesToast`, `changesNotice` in the store) reports the count discarded or the error. The list and the diff refresh afterwards. The open diff closes, as it does after preparing.

## Consequences

- Discarding is irreversible for changes Git never stored, and for everything else once the restore has run. The confirmation names the scope, but it cannot undo.
- A discard of many files is not atomic: if Git fails on one, the earlier paths stay discarded and the list refreshes to show what remains.
- The Trash may be added later with a crate; the native plan would then move untracked files there instead of deleting them, and the dialog would say so.
