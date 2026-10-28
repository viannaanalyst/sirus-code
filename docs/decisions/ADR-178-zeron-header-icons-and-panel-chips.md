# ADR-178: Zeron header icons and panel chips

**Status:** Accepted (2026-10-28).

## Context

After ADR-177 moved the interface to the Solar icon set, the header still looked smaller and heavier
than Zeron's (github.com/zeronsh/comet, MIT): glyphs were 14 px in 24-26 px buttons, and the right
dock's tabs were 30 px pills, 200 px wide, with a border, a shadow and a "⠿" grip that replaced the
icon on hover. The owner compared a mockup built outside the repo and approved Zeron's numbers: header
icons, chip tabs "A".

## Decision

- Header icon buttons are 28x28 with a 16 px glyph and radius 6: the right-panel toggle, the Environment
  toggle, the Pull button when idle, the dock's new, maximize and collapse buttons. Window controls
  (sidebar toggle, back, forward, in the title bar and in the list sidebar's head) are 24x24 with a 16 px glyph.
- Zeron's own glyphs join the icon layer (`src/components/icons/index.tsx`) beside the generated Solar
  data: `SidebarLeft` and `SidebarRight` (a rounded frame, stroke 1.75, with a filled inner panel) and
  `ExpandArrows` / `CollapseArrows`. The panel narrows from 5.5 to 1.75 as the sidebar closes: a
  `scaleX` transition on the rect (`.sidebar-glyph-panel`, not the SVG `width` property, which WebKit
  does not animate), which animations-off and reduced motion shorten like every other transition.
- Dock tabs are chips: 112 px wide, 24 px tall, radius 6, 12 px text, 4 px apart, a 14 px icon, muted
  text (`--chip-text`). Hover washes `--chip-hover` (`oklch(1 0 0 / .06)`), the selected chip
  `--chip-selected` (`.10`) with primary text; no border, no shadow; light theme uses the same ink at
  the same alphas. The close button (12 px glyph in a 16 px hit area) shows on hover, focus and on the
  selected chip. The grip glyph is gone; the whole chip starts the drag.
- Fixed-width chips can overflow the strip (about 40 px tall): it scrolls horizontally without a scroll
  bar, keeps the selected chip in view and fades 36 px at each edge that hides more.
- Behaviour is unchanged: reorder, the "•" dirty marker, close, the context menu, keyboard and ARIA.

## Consequences

- The header reads closer to Zeron and is easier to hit; the chips take less room, so more panels fit.
- A long tab name is truncated at 112 px (its full name stays in the tooltip).
- The sidebar glyphs are drawn by hand rather than generated from Solar, so they are not part of the
  Solar notice; the geometry follows Zeron (MIT) and no code was copied.
