# ADR-055: Temporary chats

**Status:** Accepted

## Context

Synara's new-chat screen has a "Temporary" toggle: a throwaway chat that is deleted when you leave it. The owner asked for it.

## Decision

**Toggle.** The new-thread landing has a Temporary toggle (`draftTemporary`, memory-only). It resets on New thread and after the first send.

**Marking.** The first send from that landing creates the session as usual and records its ID in the memory-only `temporarySessionIds`. Sidebar rows show a small chat glyph labelled "Temporary chat".

**Deletion.**

- **Timing:** a temporary session is deleted through the existing `delete_session` once it is no longer open in any pane (the selection or the split panes of ADR-053) and it has settled. A turn that is still starting, running or waiting for approval finishes first; it is never stopped automatically.
- **Worktree:** it is kept, since an isolated worktree is never removed without an explicit confirmation (ADR-004). Its side chat is removed natively with it.

## Consequences

- **Positive:** quick questions do not pile up in the sidebar.
- **Negative:** the marker is memory-only. Closing the app while a temporary chat exists keeps that session as a normal one.
- **Accepted trade-off:** an isolated worktree created for a temporary chat stays on disk until the person cleans it up.

## Alternatives considered

- **Persisting the temporary marker.** Deferred: it would need a session field and a startup sweep.
- **Removing the worktree too.** Rejected: automatic worktree removal can lose uncommitted work.
