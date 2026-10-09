# ADR-104: Terminal styles and lifetime, Material file icons

**Status:** Accepted (2026-10-09)

## Context

- **The terminal rendered plain.** At runtime Tauri adds a nonce to the `style-src` CSP of bundled assets. With a nonce present, WebKit ignores `'unsafe-inline'`, so the `<style>` element xterm creates for its colors, cursor and cell metrics was blocked. The terminal showed the UI font, no ANSI colors and no cursor.
- **Collapsing the dock killed the shell.** A terminal's view disposed xterm and stopped the PTY on every unmount. Collapsing or maximizing the dock, switching dock tabs or sessions, and moving a tab to its own region all ended the shell, and with it a running `npm run dev`.
- **File icons were generic.** The drawn per-extension icons left most files with the same sheet glyph. MonoCode uses the Material Icon Theme, as VS Code does.

## Decision

- **Styles.** `app.security.dangerousDisableAssetCspModification` is `["style-src"]`: Tauri no longer adds a nonce to `style-src`, so the policy stays `'self' 'unsafe-inline'`. Script nonces are unchanged.
- **Look.** Option "C" of the preview, Sirus's own tones:
  - ANSI palette `red #e5604d`, `green #5cc36b`, `yellow #e5b94d`, `blue #8c9bff`, `magenta #c08cff`, `cyan #5fc7c7` on dark, with darker variants on light (`terminalAppearance`);
  - a blinking cursor (outlined while unfocused) in the person's cursor style;
  - line height 1.15.
- **Lifetime.** `TerminalPanel.tsx` keeps a module-level map of live terminals: xterm, its element and the PTY subscriptions. A view attaches the element when it mounts and only detaches it when it unmounts, so the shell keeps running and the screen is kept.
  - The shell stops when its tab is closed, its session is removed (a store subscription catches both while no view shows it), or the person reopens an ended terminal.
- **Links and text.**
  - http(s) addresses in the terminal, `localhost` included, are links (`@xterm/addon-web-links`). They open like links in replies (`openLink`; ⌘-click forces the system browser).
  - Shells get a UTF-8 `LANG` when the app was opened without a UTF-8 locale (Finder gives none), keeping the person's language and region; an explicit `LC_ALL` is respected. Without it, zsh printed accents in folder names as `\M-^C`.
  - "Add to chat" stacks above xterm's layers.
- **Icons.** `FileGlyph` shows the Material Icon Theme glyph (`react-material-icon-theme`, MIT) for files and folders. This covers the file tree, file search, Changes, changed-files card, chat file links, composer file suggestions and mobile files.
  - The roughly 1 MB pack loads after first paint. Until then each row shows the drawn icon from `file-icons.ts` at the same size.
  - Lookup tries the full name, then each compound suffix (`material-file-icon.ts`).

## Consequences

- A dev server started in a terminal survives collapsing the dock, switching sessions and splitting regions. Each live terminal keeps its xterm in memory until it is closed (at most 8 per session, scrollback bounded as before).
- Inline styles from bundled assets are no longer nonce-gated. Scripts still are.
- File icons match what people know from VS Code. The icon pack is a separate lazily loaded chunk.
