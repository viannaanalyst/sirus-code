# Monos preview

Open `index.html` (built from `source.html` by `node previews/monos/build-preview.mjs`, which inlines the provider marks). It previews Monos, persistent agents inspired by MonoCode's: each has a name, an animated cosmic icon, a colour, a chat background, its own conversation, assigned projects, and Soul (`SOUL.md`), Memory and Habits pages.

- **Rail:** Monos sit under the Home icon with an unread dot; `+` creates one.
- **Chat:** example habit report, a batch of delegated sessions and a habit suggestion that can be accepted.
- **Details:** provider and model, assigned projects, an editable Soul, memory facts (add and forget) and habits (toggle, latest runs).
- **Appearance dialog:** name, icon style (Metal, Pixel, Neon), 16 cosmic icons (orbit, ringed planet, moon, sun, galaxy, nebula, comet, black hole, star, pulsar, constellation, satellite, rocket, planet, asteroid, eclipse), eight colours and five chat backgrounds, with a live preview.

Icons are drawn on canvas from one function each. Pixel renders the Metal drawing at 22 px with solid alpha and scales it up without smoothing; Neon recolours to the Mono's colour with a glow. Everything is memory-only. Reduce Motion shows still frames.

App Genie's icon library (icons.appg.co) was considered: it offers AI-generated PNG app icons with a single space icon and no stated license terms beyond "free", so the set here is drawn in the product's own orbit style instead.
