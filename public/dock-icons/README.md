# Dock artwork

Runtime selection and original-icon restoration are defined in
[ADR-033](../../docs/decisions/ADR-033-persisted-appearance-and-native-glass.md).
Native alternatives are embedded from `src-tauri/icons/`; their PNG bytes must
match the corresponding thumbnails here.

## White

`white.png` derives from the owner's supplied white orbital icon. Its exterior
checkerboard was baked into the source image. The built-in `image_gen` tool
produced genuine exterior alpha and a continuous silver rim, retaining the
white tile and orbital artwork. No CLI image-generation fallback was used.

Final prompt:

> Edit target: supplied white orbital Dock icon. Preserve exactly the white background tile and existing chrome orbital symbol, two crossing ribbons and three spheres. Produce a clean application-icon PNG with real transparent exterior. REQUIRED specific edge correction: add a clean continuous medium-gray metallic rim around the white tile, roughly 4 pixels wide at 1024 resolution, sharply defining the exact rounded-square silhouette. This gray rim must be geometrically smooth on all four straight sides and rounded corners; no white pixels may extend beyond this rim. Do not cut through or distort the orbital artwork. Transparent outside the gray rim, no checkerboard, no external shadow, no fragments. Centered square artwork with a modest transparent margin. Smooth antialiased silhouette is essential.
