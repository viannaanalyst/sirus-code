# Dock artwork

Runtime selection and original-icon restoration are defined in
[ADR-033](../../docs/decisions/ADR-033-persisted-appearance-and-native-glass.md).
Native alternatives are embedded from `src-tauri/icons/`; their PNG bytes must
match the corresponding thumbnails here.

## Sirus Code mark

All tiles derive from the owner's flat white "S" orbit artwork (2026-10-07; 1254 px, black background), replacing the earlier silver mark. Alpha is recovered from brightness and the mark is filled flat (white, or near-black on light), then composited onto a macOS rounded-square tile (824 px tile with a 100 px margin on a 1024 px canvas, the mark at 70 % of the tile): `default.png` on near-black, `smoked-glass.png` on translucent graphite and `white.png` with a near-black mark on light grey. The bundle `icon.icns` and the 16–64 px PNGs use a copy of the mark with thickened hairlines so the orbits survive small sizes; `public/sirus-glyph-small.png` is that thicker mark for the 20 px sidebar brand, and `public/sirus-glyph.png` the full mark for the landing and splash. In the light theme the glyphs are drawn near-black.
