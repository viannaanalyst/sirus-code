# Premium motion previews

Open `index.html` directly. `source.html` is the editable source; `node build.mjs` embeds a downscaled copy of `public/switchyard-glyph.png` to produce the self-contained `index.html`. No dependencies, native IPC or network access.

Two tabs, each with options that combine:

- **Configurações.** A: how Settings opens — A0 current instant swap, A1 Depth (app recedes and blurs, Settings arrives from a slight zoom), A2 Push (slides in from the right), A3 Born from the gear (circular reveal from the gear button), A4 Glass (the app frosts behind a translucent Settings). B: how a menu's content enters — B0 current, B1 Cascade (title, then each group in sequence), B2 Directional (content moves with the menu direction), B3 Focus (blur out / blur in). Optional gliding menu indicator.
- **Abertura do app.** C0 current dark window, C1 Glass and logo (frosted translucent window, breathing logo, glass dissolves into the app), C2 Metallic sheen (light sweep over the glyph plus a hairline loader), C3 Logo becomes the app (C2, then the logo flies into the landing glyph position).

Speed (1×, ½×, ¼×), simulated load time and a reduced-motion switch (short fades only) help inspect timing. The colourful backdrop stands in for the macOS desktop so translucency is visible; in the product, glass depends on the existing macOS window-glass support and falls back to an opaque splash elsewhere. No production components are changed by this preview.
