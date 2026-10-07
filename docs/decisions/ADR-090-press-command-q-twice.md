# ADR-090: Press ⌘Q twice to quit

**Status:** Accepted

## Context

⌘Q sits next to ⌘W and ⌘A, and quit Sirus at once whenever no agent was running. A stray press closed every session view, terminal and browser tab. Several options were compared as previews:
- press twice;
- hold to quit;
- always ask, as Synara does;
- ask only with agents running, which was Sirus's behaviour.

The owner chose pressing twice.

## Decision

- The app menu's Quit (⌘Q) calls `close::quit_pressed`.
- **With agents running**, and "confirm close when running" on, quitting goes straight to the existing running-agents dialog.
- **Otherwise**, the first press emits `quit-armed` and shows "Press ⌘Q again to quit" at the top of the window, with a ring that empties over two seconds. A second press within those two seconds quits. Later presses start over.
- The toast is shown in the main window and in the floating Astro chat.
- "Quit SirusCode" in the menu bar menu quits on the first click, because it is already a deliberate choice.

## Consequences

- Quitting with the keyboard takes two presses. Nothing else changes: closing the window and the running-agents dialog behave as before.
