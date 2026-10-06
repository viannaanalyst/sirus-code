# New thread effect previews

Three original silver/graphite background directions, presented in the same Sirus Code New thread composition with the actual logo, import banner layout, product typography/dimensions and shared metallic composer. The approved **Órbitas** drawing is shared with the product through `src/lib/landing-orbits.ts`, and the comparison opens at **100% intensity / Fast**, matching the product. These are visual previews only: workspace/model/approval labels are illustrative, Send is simulated, and no native IPC or project state is changed by the previews.

## Open

Run the existing Vite server and visit `/previews/new-thread-effects/`. The three choices are also addressable with `?effect=mare`, `?effect=veu` and `?effect=orbitas`. The chooser supports Left/Right, Home/End and ordinary keyboard activation.

Build portable versions with `node previews/new-thread-effects/build-preview.mjs`. This creates a self-contained `preview.html` comparison plus `01-mare-de-prata.html`, `02-veu-de-luz.html` and `03-orbitas.html`. Each includes local images, styles, fonts and scripts, and works without a running server.

## Directions and references

- **Maré de prata:** a diagonal topographic wave, with fine mesh dots and sparse traveling glints. Visual research: [Animated Mesh Lines by Jérémie Boulay / Codrops](https://tympanus.net/codrops/2019/01/08/animated-mesh-lines/).
- **Véu de luz:** layered silver sheets, delicate folds and diffused edge lighting. Visual research: [Paper God Rays](https://shaders.paper.design/god-rays) and [Paper Mesh Gradient](https://shaders.paper.design/mesh-gradient).
- **Órbitas:** thin elliptical paths framing the logo, subtle nodes and a deterministic star field. An original alternative using the same restrained light/material vocabulary.

Background drawings are original Canvas 2D implementations rather than copied demo code. The existing Apache-2.0 Paper liquid-metal shader is reused for the composer and Add control; license files remain under `public/licenses/paper-shaders/`.

## Motion and scope

Only the selected background draws. Canvas rendering is capped at 900,000 physical pixels and approximately 30 fps, with geometry measured only on resize. The loop stops on manual pause, textarea focus, offscreen visibility, hidden document and OS reduced motion. Resume preserves animation time. Reduced motion retains a static frame. Speed affects the background; the already-approved composer keeps its slow material speed. Intensity is adjustable independently. Page hide disconnects observers, stops frames and disposes the metal mounts; page show restores them for the back/forward cache. There are no new dependencies, polling or global pointer listeners.

Scoped typecheck: `./node_modules/.bin/tsc --noEmit -p previews/new-thread-effects/tsconfig.json`.
