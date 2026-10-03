# Settings switch studies

Three interactive, offline-capable studies matching Switchyard's dark surfaces,
native system typography, bundled orbital glyph and Lucide icons.

1. **Prata suave** — satin silver thumb, a bounded settling animation and a subtle check.
2. **Metal líquido** — dark chrome sphere and a finite reflection pass on activation.
3. **Órbita** — silver pearl, finite orbital rotation and a subdued cool signal.

`index.html` compares all three, including on/off/disabled examples and switches
at actual settings size. Numbered pages put each option in the same General
layout. All are self-contained, without remote assets or runtime dependencies.
The mapped features are documented in
[`general-settings-synara-map.md`](../../docs/development/general-settings-synara-map.md)
and summarized in `mapeamento.html`.

Click, Space and Enter toggle the native buttons (`role="switch"`, named,
`aria-checked`). Disabled examples remain disabled. Restore resets only the
illustrative values. Reduced motion respects both the OS and the preview control.
Animations run only on a state change and end after 320 ms; no ambient loop,
native IPC, preferences persistence, process start or permissions are involved.
The production Switch is unchanged pending selection.

Build:

```sh
node previews/settings-switches/build-preview.mjs
```

Serve locally or open any HTML offline:

```sh
python3 -m http.server 8771 --bind 127.0.0.1 --directory previews/settings-switches
```

Comparison: `http://127.0.0.1:8771/`.
