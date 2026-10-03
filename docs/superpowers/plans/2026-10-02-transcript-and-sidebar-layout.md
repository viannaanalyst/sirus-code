# Transcript anchoring and sidebar frame

- Anchor each newly admitted user message at the top of the transcript. Reserve the latest turn's viewport space, transfer to end-follow as output exceeds it, and preserve manual history scrolling and bookmark jumps.
- Restore owner-filtered project folders in Home, keep global pins unique, and move search/draft controls next to the title. Remove the footer count/Open project, duplicate docked collapse, and activity sort controls. Keep floating-panel pin behavior.
- Compact rail icons and draw one rounded content frame beneath the window titlebar; remove the independent usage divider.
- Select review preview 03 by default. Show the Synara-style Undo arrow only on sent-message hover or keyboard focus; rollback remains a fixture simulation.
- Verify meaningful DOM scrolling/filter behavior, existing type/lint/tests, frontend/desktop builds and a focused review.

No new IPC, native mutations, dependencies or provider authority.

Completed: real SessionPane DOM/browser regressions cover initial/new sends, short settlement, viewport resize, long stream/end follow, manual history and programmatic near-end bookmarks. Real Sidebar checks cover grouped ownership/header actions, compact rail/frame bounds and hover departure. Preview hover and keyboard focus both pass. Removing the reserve in the negative control fails the anchor assertion, reproducing the former behavior.

Validation: application/test and preview type checks, lint, 154 Node tests plus existing SSR regressions, isolated component browser regression, cargo check, desktop build and strict signature verification. Graphify updated incrementally. The app was not restarted.
