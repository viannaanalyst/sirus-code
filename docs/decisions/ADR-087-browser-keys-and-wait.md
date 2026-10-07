# ADR-087: Browser keys and waiting for agents

**Status:** Accepted

## Context

T3 Code gives its agents preview tools that press keys and wait for the page, and Sirus's browser tools (ADR-030) lacked both. An agent could type into a field but could not press Escape, move with Tab or wait for a page to finish rendering. Separately, a tab an agent opened while the dock pane had never been shown was 1×1, so its screenshots were useless.

## Decision

1. **`browser_press`** presses one key from a fixed list on the focused element: Enter, Escape, Tab, Backspace, Delete, the arrows, PageUp, PageDown, Home, End and space (`BROWSER_KEYS`). Enter submits the field's form, Backspace edits fields, Tab moves focus, and the scrolling keys scroll the page. Like the other mutating tools, it stops if the person used the page in the last 1.5 s.
2. **`browser_wait_for`** waits until a text appears on the page or a selector matches. It polls every 150 ms for at most 8 s, below the 10 s limit of the page call.
3. **Tab size.** Tabs are created 1280×800 instead of 1×1, so a tab opened by an agent lays out and captures like a window even before the pane is shown. The pane's measured bounds take over once it is visible.

There is still no tool that runs arbitrary JavaScript. As in T3 Code, the phone app has no browser screen; the browser stays on the Mac.

## Consequences

- Agents can drive keyboard-only flows (menus, dialogs, search boxes) and wait for slow pages instead of guessing with retries.
- Keys outside the list are refused with the list of accepted keys.
