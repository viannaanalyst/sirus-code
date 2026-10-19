# ADR-063: Usage-limit notice and resume at reset

**Status:** Accepted

## Context

When a provider's account limit is spent, the turn failed with a generic error and queued requests stayed paused. The owner asked to see when the limit resets and to continue by itself.

## Decision

**Detection.** It is native and uses only provider reports.

- **Codex:** `codexErrorInfo: "usageLimitExceeded"` on the `error` notification or the failed turn. The reset is the latest `resetsAt` among `account/rateLimits/updated` windows at or over 100%.
- **Claude:** a `rate_limit_event` with `status: "rejected"` that is not paid by extra usage, or a failed result whose text says the limit was reached. Its `resetsAt` is the reset.

The turn fails with code `usage_limit`, and `Session.usageLimit = { resetsAt }` is persisted. The next send clears it.

**Notice.** Above the composer it shows "Usage limit reached · Resets at 15:16 · in 4h 42m". When the stream gave no reset, the renderer asks the existing usage probe (`provider_usage`) for the spent window. The countdown moves by minutes.

**Resume.** Resuming is explicit. "Resume at reset" arms an automatic continue for that notice (memory-only). One renderer timer waits for the earliest armed reset plus 30 seconds, rechecking at least every 5 minutes because timers stall while the Mac sleeps. It then sends "Continue from where you left off." with the session's last admitted execution. A queue that the limit paused follows once that turn succeeds. After the reset, "Resume" sends the same turn by hand, and the notice can be dismissed.

## Consequences

- **Positive:** a long task survives a usage limit without the person watching the clock.
- **Negative:** the automatic continue is the second exception, after automations, to "turns start from an explicit Send". (Since the 2026-10-18 amendment one setting arms every notice; it is off by default and each notice can still be cancelled.)

## Alternatives considered

- **Arming by default.** Rejected: it would start turns without the person's action.
- **Native timers.** Rejected: the renderer already owns the queue, and the resume needs no new IPC.

## Amendment (2026-10-18): automatic by default

The owner asked for the resume to be automatic. A new setting, `usageAutoResume` (Settings → General → Application; off by default, like the reference app the owner compared), arms every usage-limit notice whose reset is known and later than the moment the turn stopped; a reset that had already passed when the limit was reported never arms itself, so a stale report cannot loop. The notice shows "Resuming at reset" with Cancel; cancelling records that reset for the session (`usageResumeCancelled`, kept in local storage so it survives a restart) and a later limit with a new reset arms again. With the setting off, "Resume at reset" still arms one notice by hand. The timer now rechecks every minute and again when the window regains focus or becomes visible, so a resume missed while the Mac slept or the app was in the background fires within moments of coming back; a reset that passed while the app was closed fires on the next launch. What is sent and the queue that follows are unchanged.
