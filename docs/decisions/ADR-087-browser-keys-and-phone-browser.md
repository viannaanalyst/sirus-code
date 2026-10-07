# ADR-087: Browser keys for agents and the browser on the phone

**Status:** Accepted

## Context

T3 Code gives its agents preview tools that press keys and wait for the page, and Sirus's browser tools (ADR-030) lacked both. An agent could type into a field but could not press Escape, move with Tab or wait for a page to finish rendering. The phone app (ADR-081) also had no way to see or use the conversation's browser on the Mac. T3 Code's phone app has no browser either.

## Decision

1. **Two more agent tools.**
   - `browser_press` presses one key from a fixed list on the focused element: Enter, Escape, Tab, Backspace, Delete, the arrows, PageUp, PageDown, Home, End and space (`BROWSER_KEYS`). Enter submits the field's form, Backspace edits fields, Tab moves focus, and the scrolling keys scroll the page. Like the other mutating tools, it stops if the person used the page in the last 1.5 s.
   - `browser_wait_for` waits until a text appears on the page or a selector matches. It polls every 150 ms for at most 8 s, below the 10 s limit of the page call.
   - There is still no tool that runs arbitrary JavaScript.
2. **The browser on the phone.** "Browser" in the conversation's ⋯ menu opens `MobileBrowser`, which shows the tabs, an address bar with back, forward and reload, and a live picture of the active tab.
   - **The picture.** `browser_preview` returns a JPEG of the visible page, 720 pt wide at quality 0.6. The phone polls it every 1.2 s while the screen is open and the app is in front.
   - **Using the page.**
     - Tapping the picture clicks the page there: `pageTapPoint` maps the tap to fractions of the visible page and skips the letterbox bands.
     - Swiping scrolls the page.
     - A text field types into the focused element, optionally submitting its form.
     - A key row sends Enter, Delete, Tab, Esc and scroll steps.
   - **The person's own input.** These go through `browser_person_action`, which is validated in Rust (`PersonAction::is_valid`). They mark `window.__sirusHumanAt` like a click on the Mac does, so an agent acting on the page pauses.
3. **Tabs without the dock pane.** Tabs are created 1280×800 instead of 1×1, so a tab opened by an agent or the phone lays out and captures like a window even if the pane was never shown on the Mac. The pane's measured bounds take over once it is visible.

## Consequences

- The phone works the Mac's real tab and shares its cookies and logins. Nothing runs in the phone's own browser.
- The picture is a polled snapshot, not a video stream. Animations look choppy, and each picture costs about 50–200 KB over the tailnet.
- Typing goes to whatever field the page has focused. If no field has focus, the phone says to tap one first.
