# Bundled fonts

Appearance uses these local WOFF2 assets; product font loading never contacts a CDN. Fontsource package font-family names are kept intact. Latin and Latin Extended cover the default Portuguese/English UI. Existing IBM Plex Mono remains supplied by the installed @fontsource/ibm-plex-mono dependency. Installed-only choices use local system fonts and fall back to system UI/monospace when absent.

- `@fontsource-variable/dm-sans@5.3.0` — https://registry.npmjs.org/@fontsource-variable/dm-sans/-/dm-sans-5.3.0.tgz, original LICENSE beside assets.
- `@fontsource-variable/fira-code@5.3.0` — https://registry.npmjs.org/@fontsource-variable/fira-code/-/fira-code-5.3.0.tgz, original LICENSE beside assets.
- `@fontsource-variable/geist-mono@5.3.0` — https://registry.npmjs.org/@fontsource-variable/geist-mono/-/geist-mono-5.3.0.tgz, original LICENSE beside assets.
- `@fontsource-variable/geist@5.3.0` — https://registry.npmjs.org/@fontsource-variable/geist/-/geist-5.3.0.tgz, original LICENSE beside assets.
- `@fontsource/ibm-plex-sans@5.3.0` — https://registry.npmjs.org/@fontsource/ibm-plex-sans/-/ibm-plex-sans-5.3.0.tgz, original LICENSE beside assets.
- `@fontsource-variable/inter@5.3.0` — https://registry.npmjs.org/@fontsource-variable/inter/-/inter-5.3.0.tgz, original LICENSE beside assets.
- `@fontsource-variable/jetbrains-mono@5.3.0` — https://registry.npmjs.org/@fontsource-variable/jetbrains-mono/-/jetbrains-mono-5.3.0.tgz, original LICENSE beside assets.
- `@fontsource-variable/roboto-mono@5.3.0` — https://registry.npmjs.org/@fontsource-variable/roboto-mono/-/roboto-mono-5.3.0.tgz, original LICENSE beside assets.
- `@fontsource-variable/source-code-pro@5.3.0` — https://registry.npmjs.org/@fontsource-variable/source-code-pro/-/source-code-pro-5.3.0.tgz, original LICENSE beside assets.
- `@fontsource/ubuntu-mono@5.3.0` — https://registry.npmjs.org/@fontsource/ubuntu-mono/-/ubuntu-mono-5.3.0.tgz, original LICENSE beside assets.

`src/styles/fonts.css` contains the preserved font weights and Unicode ranges. UI families and monospaced families are selected through closed IDs, independently of terminal and code sizes. Variable fonts cover their published weight range; static Plex Sans includes 400/500/600 and Ubuntu Mono includes 400/700. Font assets and their original licenses are in `src/assets/fonts/`.

The original licenses are also copied into `public/font-licenses/` so Vite includes them in the distributed desktop web assets.
