# ADR-061: Undo a turn's changes

**Status:** Accepted. Amends ADR-040: the turn summary now offers Undo.

## Context

ADR-040 kept turn reviews read-only (Keep/Review, no Undo). MonoCode and Synara let the person undo what a reply changed. The owner asked for it.

## Decision

**What is undone.** A settled turn's retained text diffs (the latest 16 nonempty reviews) are applied in reverse with `git apply -R`. Each file is handled separately, after a `--check` (`turn_undo.rs`).

**Safety.**

- **Later edits:** a file changed again since the turn in the same lines fails the check and is left untouched. Edits made after the turn elsewhere in the file are kept, as with `git revert`.
- **Created and deleted files:** a file the turn created is removed only if it still matches what the turn wrote. A file the turn deleted is recreated from its retained diff.
- **What it never touches:** the index, commits and other files. Binary files, expired diffs and files over the diff limit are reported as not undone.
- **Paths:** they come only from the native review and are rechecked with the review's name rules. Inside a repository, `--directory=<prefix>` keeps them relative to the session workspace, because `git apply` otherwise reads them from the repository root.
- **Git guards:** the shared native Git guards apply (hooks and filters refused, fixed binary).

**IPC.** One new command, `undo_turn_changes({ sessionId, messageId, paths?, confirm })`. It requires `confirm: true`, an owned session that is not running, and a settled turn with a review; the requested paths must belong to that review. Undone files record `undoneAt`, which is persisted.

**UI.** The turn summary has Undo next to Keep. The historical review pane has "Undo this file". Both open a red confirmation that says unrelated later edits are kept. A file that cannot be undone is counted ("changed again since then"), never forced.

## Consequences

- **Positive:** a bad reply can be reversed without Git knowledge or losing later work.
- **Negative:** there is no undo once the diff has expired or for binary files. A concurrent external edit between the check and the apply is a race, as with any Git command.

## Alternatives considered

- **Full before/after checkpoints (MonoCode).** Rejected for now: it needs separate storage and cleanup. The retained diffs already cover the recent turns.
- **Overwriting the current file with its earlier content.** Rejected: it would destroy edits made after the turn.
