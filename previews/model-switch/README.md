# Model switch animation previews

Open `index.html` to compare animations for two moments. Edit `source.html` and run `node previews/model-switch/build-preview.mjs`; it inlines the bundled provider marks into `index.html`.

**Picker (composer model trigger):**

1. Metallic flip: the icon turns like a coin, the model name rises through a blur, and the composer rim lights in the provider tint.
2. Orbit: the old icon leaves along an orbit while the new one enters from the opposite side, with a ring flash.
3. Colour wave: a wave in the new tint spreads from the trigger across the composer.
4. Roll with glow: the model name rolls like a counter, and the icon springs with a halo.

**Handoff in the same conversation (sending to another AI):**

1. Baton: a divider draws from both sides, and the old mark hands over to the new one in the centre pill.
2. Trail: the transcript trail continues in the new tint, and a node morphs one mark into the other.
3. Spotlight: earlier messages dim briefly, an "Now with …" chip appears, and a light sweep crosses the reply.
4. Card to marker: the pending handoff card flies into the transcript and shrinks into a thin marker.

Choose a target in each card's chips; Replay plays it again. Model names are visual examples, not catalog claims. Everything runs in the file, with the Web Animations API and no network or IPC. With Reduce Motion on, durations collapse to short crossfades.

## Chosen direction

The owner picked handoff option 4 (card to marker) and picker option 2 (orbit), with a full-column scene per provider. `scenes.html` (from `scenes.source.html`) previews that: switching from the composer trigger or the chips plays the orbit swap and a canvas scene behind the conversation. A scene appears only on a switch and lasts 5 s: it fades in over 0.5 s, holds and fades out between 4 s and 5 s. The canvas loop then stops until the next switch.

| Provider | Scene |
| --- | --- |
| Claude Code | Coral sun with asterisk rays and orbits |
| Codex | Petal knot of six loops, teal aurora |
| OpenCode | Falling terminal glyphs and a blinking block cursor |
| Grok | Event horizon with an accretion disk and a slash of light |
| Cursor | Rotating wireframe prism with a light beam |
| Antigravity | The logo arch levitating over expanding field rings, particles rising into it |
| Droid | Turning gears and conveyor lanes |
| Pi | The three logo blocks fly in and snap together over a pixel grid |
| Devin | The logo inside a hex lattice with light waves travelling outward |

All scenes share twinkling stars and shooting stars in the provider tint. The canvas pauses while the page is hidden; Reduce Motion draws one still frame.

### Assembly style (default)

Following the owner's preference for Pi, every provider now assembles its own logo from blocks over the same pixel grid, then floats gently; a white frame flashes when the last block lands. The logo is cut into an 8×8 grid of tiles, and each provider moves them its own way: Claude converges from rays, Codex spirals in, OpenCode types in row by row, Grok is pulled in around a flattened orbit, Cursor's columns fall from above, Antigravity rises from below, Droid slides in from the left, and Devin expands from the centre. Pi keeps its three-block version. "Cenas antigas" switches back to the earlier scenes for comparison.
