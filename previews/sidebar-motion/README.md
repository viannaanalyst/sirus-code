# Sidebar motion previews

Open `index.html` directly. It is one self-contained, interactive mock window with no build step, dependencies, native IPC or network access.

Pick one option from each group; they combine:

- **A · Open/close (⌘B):** A0 current instant width swap, A1 Slide (width eases, content slides and fades in, closes faster than it opens), A2 Curtain (content stays put while the edge reveals it), A3 Spring (slight overshoot with staggered rows).
- **B · Collapsed peek panel:** B0 current 320px full-height card, B1 Glass card (264px translucent card that slides out of the rail with staggered rows), B2 Drawer (slides out from behind the rail, attached to it), B3 Anchored (content-height card with a notch that glides between the rail icons).

The panels reuse the shipped gliding hover pill. Speed (1×, ½×, ¼×) and a reduced-motion switch help inspect timing; reduced motion keeps only a short fade. The Pin button inside the peek docks the sidebar using the selected A animation. Durations and easing are expressed with the app's motion tokens (`--ease-out`, 140/200/320 ms); B1/B3 glass is illustrative and would follow the existing popup-glass appearance setting in the product. No production components are changed by this preview.
