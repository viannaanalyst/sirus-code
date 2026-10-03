# Popup palette/material proposal

Run `node previews/popup-themes/server.mjs` and open http://localhost:4192/.

Four visual variants separate Dark/Light palette from Solid/Glass material. Comparison cards and the interactive workspace show the same menu geometry, typography and opaque text. Glass uses a tinted background and backdrop blur, never opacity on the whole control. The example includes dropdown selection, session popover, keyboard-focus tooltip and a native HTML modal with Escape/focus return.

This is a visual proposal. It does not change production AppSettings or ADR-033's retained three-mode schema. The wallpaper simulates desktop glass; CSS does not promise native macOS blur. Existing local font/glyph assets come from the agent-activity preview.
