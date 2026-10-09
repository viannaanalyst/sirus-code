# ADR-103: Snooze a conversation with a reminder

**Status:** Accepted

## Context

Finished conversations that need a follow-up later (a deploy to check tomorrow, a review on Monday) stayed in the header tabs and the switcher until then, or were archived and forgotten. Synara snoozes a chat until a chosen time, shows a countdown, and brings it back unread with a reminder (its snooze reactor, countdown, Return now / Change time, undo toast). The reminder has to fire while the window is hidden and after the app was closed, so the renderer cannot own the timer.

## Decision

- **State:** `Session.snoozedUntil` (RFC 3339, `Option<String>`, serde default, omitted when empty) in `models.rs` and `src/client/types.ts`. `snoozeReminderAt` records when a reminder fired; the conversation reads as unread until it is opened.
- **Command:** `snooze_session { sessionId, until }` (`src-tauri/src/snooze.rs`). A time must be in the future and at most a year ahead; starting, running or waiting sessions refuse. `until: null` returns the session now and clears `snoozeReminderAt`; the renderer calls it the same way when a returned conversation is opened, which acknowledges the reminder. It saves, emits `session-updated` and re-arms the timer. Remote access allows it like the other session edits (the remote policy is a deny list of Mac-only commands).
- **Timer:** one tokio task sleeps until the earliest `snoozedUntil` and wakes on a `Notify` when a snooze changes; with nothing snoozed it only waits for that signal. Its sleep is monotonic and stops while the Mac sleeps, so it re-reads the wall clock at least every 10 minutes. When a time comes it clears `snoozedUntil`, sets `snoozeReminderAt`, saves, emits `session-updated` and calls `notifications::remind`. The first pass at launch fires reminders missed while the app was closed, once each.
- **Alert:** `remind` builds a `reminder` notice titled "Reminder" / "Lembrete" with "project · session" and sends it through the existing channels: the in-app activity toast, the macOS notification (the click opens the session through `notification-open`), the completion sound and paired phones. Toasts, system alerts, sounds and the foreground switch apply; no event switch hides it, because the person asked for it. The final delivery gate accepts it only while the session is still back and unacknowledged.
- **Renderer:** `isSnoozed` (`src/lib/snooze.ts`) is true for a settled session with `snoozedUntil`; `selectListedSessions` drops such sessions, so they leave the tabs, switcher rows, board and search. A turn that starts in one brings it back to the lists. `selectSnoozedSessions` feeds a collapsible "Snoozed (N)" group at the end of the switcher's session column: a moon, the title, a live countdown ("back in 2 h 10 min", ticking every 30 s inside its own component), and Return now / Change time (hover buttons and a context menu). "Snooze…" sits in the switcher row menu and the header tab menu (disabled with a hint for running or waiting sessions). It opens a small popover with 1 hour, 3 hours, Tomorrow at 9 AM, Next Monday at 9 AM and "Pick a date and time…", which unfolds date and time inputs. The popover uses the shared popup entrance and row cascade (ADR-096). Snoozing closes the tab (the selection moves like closing it would) and raises an Undo toast in the top toast stack ("Conversation snoozed until tomorrow at 9 AM · Undo"); Undo returns it with its tab, selected again if it was on screen. A returned conversation joins the unseen sessions and gets its tab back.
- **Dates:** presets are local time from a passed clock: hours are elapsed time rounded to the minute; Tomorrow and Next Monday land at 9:00 local (on a Monday, Next Monday is a week later). Deadlines and countdowns use the app locale ("amanhã às 9h", "tomorrow at 9 AM").

## Consequences

- **Positive:** reminders fire with the window hidden or after a restart, without a renderer timer or a polling loop; the unread state survives restarts until the conversation is opened.
- **Negative:** a reminder due while the Mac sleeps can arrive up to 10 minutes after it wakes. The context menu has no submenus, so presets live in a popover one click further.
- **Accepted trade-off:** opening a returned conversation costs one `snooze_session` call to clear its reminder.
- Tests: `snooze.rs` (earliest wake, wake marks unread and clears, missed reminders at launch, active sessions refuse), a reminder case in `notifications.rs`, `tests/snooze.test.ts` (preset date math on a fixed local clock, labels, countdowns) and the Snoozed group in `scripts/verify-cascade.mjs` (SSR).

## Alternatives considered

- **A renderer timer:** it stops with a hidden or closed window and cannot fire missed reminders at launch.
- **Polling every minute:** simpler, but the app avoids polling loops (see Performance in the architecture reference).
- **Reusing the memory-only unseen list for the unread mark:** it does not survive a restart, so a reminder that fired at launch would come back read.
