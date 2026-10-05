# ADR-053: Side-by-side conversations

**Status:** Accepted

## Context

The owner asked for MonoCode's split view: two or more conversations open at once, placed by dragging a conversation to the left, right, top or bottom of a pane. Four drag feedback styles were previewed; the owner chose "lit half", where the half of the pane that will receive the conversation lights up and glides between edges.

Much of the renderer assumes one selected session: the composer and its draft owner, `send_prompt`, approvals, the right dock, the Environment card, transcript search, Escape-to-stop and keyboard shortcuts.

## Decision

**Layout.**

- **State:** a memory-only binary tree of panes in the existing store (`splitLayout`), at most 4 panes, ratios bounded to 20–80%. Nothing is persisted and nothing crosses IPC.
- **Active pane:** it always shows the selected session, so everything that follows the selection follows the active pane. Selecting a session elsewhere (sidebar, tabs, palette) activates the pane already showing it, or puts it in the active pane.
- **Other panes:** passive views of their session's transcript, which is kept loaded through `useRetainedTranscripts`. A stand-in composer replaces the real one, and approvals, search and selection actions stay in the active pane. Pressing or focusing a passive pane makes it active and, from the stand-in composer, focuses the real composer.
- **Rendering:** panes are positioned from the tree and keyed by pane, so splitting or moving never remounts a conversation. The layout glides on change, and new panes fade in.
- **Cleanup:** panes of deleted sessions close. Closing a pane never changes the session.

**Placing conversations.**

- **Dragging:** from a sidebar row or a pane's grip. The pressed button captures the pointer, so there are no window listeners. The drag starts after 5 px, so a click still selects. Escape cancels.
- **Targets:**
  - near a pane edge, a new pane opens on that side;
  - the middle replaces the pane's conversation, or swaps places when the dragged conversation is already open;
  - a 28 px strip along the whole area splits the area.
- **Limit:** at the pane limit, the highlight turns red and only replacing is allowed.
- **Keyboard and menu alternatives:** "Open to the side" and "Open below" in a session's context menu, and arrow keys on a focused divider.

## Consequences

- **Positive:**
  - Several running sessions can be watched at once.
  - No new IPC, capability, persistence or native code.
  - Composer, approvals and Send keep a single owner.
- **Negative:**
  - Typing into a passive pane first needs a click to make it active.
  - The layout resets on restart.

## Alternatives considered

- **A composer in every pane.** Rejected for now: drafts, attachments, dictation and approvals are bound to the selected session, and per-pane ownership would touch most of the composer.
- **Compass targets, live reflow or a mini-map** (previewed). Rejected by the owner in favor of the lit half.
- **Persisting the layout.** Deferred until the view settles.
