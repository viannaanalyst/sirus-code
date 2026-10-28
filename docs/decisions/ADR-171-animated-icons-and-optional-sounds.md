# ADR-171: Animated icon swaps and optional agent sounds

**Status:** Accepted (2026-10-28).

## Context

Step five of the premium redesign covers small details. Several icons changed state by swapping
instantly: the copy buttons in Settings (connections, pairing, scheduled-task webhooks), the
sidebar show/hide control and the "expand or collapse all folders" control in a turn's changes.
The copy button in the shared arc library already crossfades.

Agents finish turns and ask for approval or an answer in the background. Today that is shown by
the activity card and the system notification, which the person may miss while working in
another window. A quiet audio cue can help, but it must never be on by default.

## Decision

- Icon state changes crossfade through `IconSwap` (`src/components/icons/IconSwap.tsx`): the old
  glyph shrinks and blurs out while the new one grows in over the same cell, so the button keeps
  its size. It uses the `motionTokens.fast` duration and ease from `src/lib/motion.ts`.
- `IconSwap` follows the app's motion preference (`useMotionPreferences`), so reduced motion,
  animations off and the reduce-motion setting all swap at once.
- The sidebar toggle fills its glyph while the sidebar is shown and draws it as an outline when
  hidden, which follows the existing convention that the filled weight marks an active state.
- Chevrons that rotate already transition with CSS and are left alone.
- A new setting, "Sounds" (`agentSounds`, off by default), lives in Settings → Notifications.
  Its Rust and TypeScript defaults and normalization stay aligned.
- When it is on, two short cues play through Web Audio (`src/lib/agent-sounds.ts`): a rising
  chime when a turn completes, and two soft taps when an agent asks for approval or an answer.
  Failures, reminders and pull request alerts stay silent. No audio files are shipped.
- A cue plays once per new activity notice. It is skipped when the conversation is in view and
  the window has focus, using the same rule as the on-screen activity card.

## Consequences

- Icon swaps animate in every place that uses `IconSwap`. Other surfaces keep instant swaps until
  they adopt it.
- Sounds are opt-in, so existing installs stay silent. A webview may hold the audio context until
  the person interacts with the app; in that case the cue stays silent rather than failing.
- The native "Notification sounds" switch and cues still control system notifications. The new
  setting controls only the in-app chimes.
