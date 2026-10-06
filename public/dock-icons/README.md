# Dock artwork

Runtime selection and original-icon restoration are defined in
[ADR-033](../../docs/decisions/ADR-033-persisted-appearance-and-native-glass.md).
Native alternatives are embedded from `src-tauri/icons/`; their PNG bytes must
match the corresponding thumbnails here.

## Sirus Code mark

All three tiles derive from the owner's supplied silver Sirus Code "S" orbit
artwork (1254 px, black background). Alpha is recovered from brightness, and
the mark is composited onto a macOS rounded-square tile (824 px tile with a
100 px margin on a 1024 px canvas): `default.png` on near-black, `smoked-glass.png`
on translucent graphite with a top sheen, and `white.png` with a darkened mark on
light grey. The bundle `icon.icns` uses a higher-contrast copy of the mark for
the 16–64 px sizes, where the hairline orbits would otherwise blur.
