# ADR-068: Provider switch motion

**Status:** Accepted

## Context

Switching to another AI in the composer, or handing a conversation to another provider, happened without feedback beyond a changed label. The owner compared animated previews (`previews/model-switch/`) and chose an orbit swap in the picker, a short scene per provider and the "card to marker" handoff.

## Decision

**Picker orbit.** When the composer's model picker selects another provider, the trigger icon plays `ProviderOrbitSwap`: the old mark leaves along an orbit, the new one enters from the opposite side and a ring flashes in the new provider's tint. Changing only the model of the same provider does not play it.

**Switch scene.** The same selection announces the switch through the memory-only `provider-switch` signal, keyed by the session id (`landing` before the first send). `ProviderSwitchScene` in the active pane plays a canvas behind the conversation for 5 s:

- The new provider's logo builds itself from blocks over a pixel grid that blinks in the provider's colours, with stars and shooting stars.
- A frame flashes when the last block lands, then everything fades out between 4 s and 5 s.
- The logo is cut into 8×8 tiles, and each provider moves them its own way: Claude converges from rays, Codex spirals in, OpenCode types in row by row, Grok is pulled in along an orbit, Cursor's columns fall, Antigravity rises, Droid slides in from the left and Devin expands from the centre.
- Pi flies its three logo blocks in whole.

`provider-scenes.ts` holds the pure drawing. The canvas exists only while a scene plays. A scene does not start, and one in progress ends, when reduced motion applies or the ambient gate is off (window not focused, document hidden, or Settings covering it). Passive split panes and side chats never play the main pane's scene.

**Handoff marker.** The transcript shows a thin divider, "‹old› › ‹new› took over", before each reply whose provider differs from the previous reply's. The comparison uses each reply's native `TurnActivity.provider`. A handoff session compares its first reply with `handoff.from`, and a streaming reply without activity uses the session's provider. While a pending `HandoffCard` is on screen it keeps its last position; when Send consumes it, the marker for the new streaming reply flies a copy of the card into place and draws its rules outward. Dismissing the card cancels the flight.

No IPC, persistence or provider behaviour changes.

## Consequences

- **Positive:** a provider switch and a handoff are visible and recognisable per provider. The marker also labels older history wherever native activity recorded the provider.
- **Negative:** replies saved before native activity existed show no marker. The card's flight starts from its last laid-out position, which can be slightly off if the composer grew after the card last rendered.

## Alternatives considered

- **A scene that stays in the background while the provider is selected.** Rejected by the owner: the scene appears only on the switch.
- **Distinct full scenes per provider (sun, black hole, network…).** Previewed and replaced by the shared assembly style, which the owner preferred after seeing Pi's.
