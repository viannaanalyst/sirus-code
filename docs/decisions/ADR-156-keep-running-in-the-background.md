# ADR-156: Keep running at full speed while another app has focus

**Status:** Accepted (2026-10-21).

## Context

When the owner switched to another app, Sirus looked frozen: the working timer, the activity line and the streamed reply stopped and caught up only on return. The agents themselves kept running, but WebKit throttled the hidden or occluded web view (timers and rendering), and App Nap could throttle the whole process, including the agent CLIs it starts at a lowered priority (ADR-143).

## Decision

- **No web view throttling.** The main window sets `backgroundThrottling: "disabled"` in `tauri.conf.json`, so the page keeps its timers and rendering when the window is not frontmost.
- **No App Nap while a turn runs.** `keep_awake.rs` already takes a reference-counted hold for every running turn (ADR-100). With the IOKit sleep assertion it now begins an `NSProcessInfo` activity with `UserInitiatedAllowingIdleSystemSleep`, and ends it when the last turn finishes or at Quit. Idle system sleep stays the IOKit assertion's job.

## Consequences

- The conversation updates live while another app has focus, and agent work is not slowed by App Nap.
- A little more energy use while agents run; once no turn is running, macOS may nap Sirus again as before.
