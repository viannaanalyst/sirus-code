# ADR-093: Settings search, ⌘J quick switch and live folding of narration

**Status:** Accepted

## Context

The owner compared Sirus with MonoCode and T3 Code and picked, from previews, four changes:
- searching all of Settings;
- a quick way to move between conversations across projects;
- folding an agent's running commentary while it works;
- new icons for the Auto and Full approval modes.

## Decision

1. **Settings search.**
   - A search field sits under "Back to app" in the Settings menu.
   - `scripts/build-settings-index.mjs` builds `src/lib/settings-index.ts` from the Settings components: every row's title, description, group and page, including rows built by `toggle`/`boolRow`/`row` helpers. A test fails when an indexed title no longer exists.
   - `searchSettings` matches every word of the query against the translated texts and page names, ignoring accents, with title matches first.
   - While searching, results replace the page: the path (page › group), the title and the description, with the matches highlighted. Pages without a match dim in the menu.
   - Opening a result goes to its page, scrolls to the row and flashes it.
2. **⌘J quick switch** (after MonoCode's live agents).
   - Lists only conversations with an agent working or waiting for you: those waiting for you first, then the rest in flight, oldest first.
   - It opens only with two or more agents working (`LIVE_MIN = 2`), shows up to four rows (`LIVE_CAP = 4`) and "+N more" for the rest.
   - Each row shows the title, what the agent is doing now, the project and the time. Typing filters, ↑↓ moves, Enter opens. It only navigates; replies happen in the conversation.
3. **Live folding** (after MonoCode).
   - While a turn runs, everything before its newest paragraph folds into one line ("N earlier messages · ran X commands…"), which opens on click.
   - The newest paragraph and the work after it stay in view.
   - Finished turns still fold before the final answer as before.
   - "Keep finished turns open" (`foldFinishedTurns` off) also keeps running turns open.
4. **Approval icons.** Auto is a robot (`Bot`) and Full access a lightning bolt (`Zap`); Ask keeps the hand.

## Consequences

- New Settings rows appear in search after running the index script; the test points to it.
- ⌘J is fixed, like ⌘K.
