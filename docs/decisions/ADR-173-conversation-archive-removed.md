# ADR-173: Conversation archive removed

**Status:** Accepted (2026-10-28). Supersedes the archiving described in ADR-029, ADR-078, ADR-086, ADR-089, ADR-124, ADR-129, ADR-130 and ADR-132.

## Context

Archiving hid a conversation from the lists without deleting it. Over time it grew into a
feature of its own: an Archived page on the desktop and the phone, a confirmation setting,
an opt-in release of the worktree, two automatic rules (pull request merged, N days without
activity) with a per-conversation opt-out, restore and delete actions on every list, and
checks in every background pass that must skip archived conversations. The owner decided the
feature is not worth that weight: a conversation is either in the list or deleted, and
Snooze already covers "not now".

## Decision

- Archiving is removed from the product: the Archive and Restore actions (hover buttons,
  context menus, the phone's swipe and long-press menus), the Archived page and its sidebar
  button, the phone's Archived page, link and search, and the confirmation dialog.
- The settings `confirmArchive`, `releaseWorktreeOnArchive`, `autoArchiveMerged` and
  `autoArchiveInactiveDays`, the list `archivedSessionIds` and the session flag
  `autoArchiveDisabled` are removed, with the Settings rows, the phone's "Conversation
  behavior" page, the `auto_archive.rs` pass, the `set_session_auto_archive` command, the
  `releaseArchived` action of `worktree_cleanup_action` and the release toast.
  Crash resume, delegation, idle compaction, CI auto-fix, PR watch and notification counts no
  longer have an archived case to skip. The Archived rail item is no longer in `RAIL_ITEMS`; a
  saved order or hidden list that names it is dropped on load.
- Older data loads unchanged: unknown settings and session fields are ignored, and the next
  save writes the state without them.
- Conversations that are archived today are deleted when the state loads, on the desktop and
  in the headless host (`archive_removal.rs`). `persist::load_from` reads
  `archivedSessionIds` (and the old `releaseWorktreeOnArchive`) from the saved state before
  those fields are dropped; `delete_archived` then runs right after `AppState` is built and
  before anything resumes work. Each conversation goes through `commands::delete_session_native`,
  the code behind "Delete conversation", so its row, transcript, attachments, drafts, pins,
  PR watches and other per-session records go the same way, along with its side chats.
- The worktree follows the same safety as the delete action and the old opt-in release. It
  is removed only if the old release setting was on and Git reports nothing to lose: no
  uncommitted or untracked changes, and a HEAD that another branch or remote contains.
  Otherwise it is kept (the cleanup in Settings lists it), and a shared or side-chat
  workspace is never removed. Branches are never deleted. A conversation that cannot be
  deleted stays in the list.

## Consequences

- Fewer states for a conversation and fewer special cases in every list and background pass.
- Archived conversations are gone for good once the app starts on this version; there is no
  restore. A backup of the data folder before updating is the only way back.
- If the app is killed after the load saved the state without `archivedSessionIds` but before
  the deletion finished, the remaining conversations stay as ordinary ones and can be
  deleted by hand.
- An older phone or desktop that still sends the removed settings or actions is ignored, and
  queued phone row actions of the removed kinds are dropped.
