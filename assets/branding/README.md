# Switchyard brand assets

- `logo-switchyard.png` at the repository root is the approved orbital artwork
  with its graphite background, copied from the owner's Downloads folder.
- `public/switchyard-glyph.png` is the transparent orbital mark used by the
  New thread landing and conversation import banner. It was extracted with the
  built-in image generation tool and reviewed on light and dark backgrounds.
- `public/switchyard.svg` embeds the generated 128 px desktop icon for browser
  favicons and the composer preview.
- `src-tauri/icons/` contains the desktop/platform icon sizes generated from
  the approved root artwork. Regenerate them with
  `npm run tauri -- icon logo-switchyard.png`, then run
  `npm run build:desktop` to update the macOS app bundle and Dock icon.
- `previous/` retains the replaced monogram and track assets for rollback.

Transparent extraction prompt: preserve the two crossed metallic orbits, three
spheres, their relative positions and internal dark chrome shading; remove the
graphite background and the negative spaces between the rings; produce clean
antialiased alpha edges without outside glow, background haze or extra details.
