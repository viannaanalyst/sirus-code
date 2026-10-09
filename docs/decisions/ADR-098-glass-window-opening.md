# ADR-098: Glass window opening, left-to-right reveal

**Status:** Accepted (2026-10-08)

## Context

The main window was created visible and opaque (`#0c0c0c`). The native glass (`appearance.rs`) arrived a moment later, and `index.html` showed a static splash (the Sirus logo with a sheen over a dark backdrop) that `src/lib/app-splash.ts` dismissed on the first ready paint by flying the logo into the landing glyph. The owner saw "everything solid, then the logo". From the design previews the owner chose option "E", reversed: the window opens already in its glass look and reveals from left to right. The owner then asked to keep the logo inside that motion: a small Sirus logo sits on the glass as the window appears, then grows slightly and fades while the wipe crosses the middle (`body::after` in `opening.css`, 480 ms, inside the reveal), so it never holds the window back.

## Decision

- **Hidden window.** The `main` window is declared with `"visible": false` (in `tauri.conf.json` and `tauri.macos.conf.json`). Setup still schedules the appearance as before. `src-tauri/src/window_reveal.rs` shows the window exactly once (`RevealOnce`). On the main thread it applies the appearance (`appearance::apply_now`), then shows and focuses the window, then applies it again. The second apply only does work if the private blur failed because the hidden window had no window number yet (`BLUR_PENDING`).
- **Ready signal.** On the first ready paint, `App` calls `playWindowOpening(() => client.windowReady())`. The `window_ready` command shows the window and resolves once it is on screen; it is ignored for other windows and denied to remote devices. The call does not wait on `requestAnimationFrame`, because WebKit pauses it while the window is hidden.
- **Fallback and reopen.** A native timer shows the window 2.5 s after setup if nothing else has, so a broken bundle never leaves an invisible app. `RunEvent::Reopen` with no visible windows (a Dock click or a second launch) shows it at once.
- **No splash.** `#app-splash`, its CSS and `src/lib/app-splash.ts` are gone, including the fly-in into the landing glyph. The landing glyph itself is unchanged. `index.html` keeps only a theme body background until the stylesheet loads; `appearance.css` makes it transparent when the window glass is on.
- **Reveal.** The motion is CSS only (`src/styles/opening.css`), driven by `html[data-opening]`:
  - `main.tsx` sets `pending` for the native main window only (not the phone, the browser or the floating Astro), which keeps `#root` hidden. A 15 s hold lets go if the app never becomes ready.
  - The attribute is `showing` while the window is asked to appear and `play` once it is on screen. During `play`, `#root` wipes in with `clip-path: inset(0 100% 0 0 round 12px)` to `inset(0)`, going from 60% to full opacity over 550 ms on `--ease-out`.
  - The pieces marked `data-opening-part` slide from `translateX(-24px)` and opacity 0 over 450 ms: the rail first, then the header (+60 ms), then the main area and composer (+140 ms).
  - The attribute is removed after 620 ms.
  - With animations off, Reduce motion on, or `prefers-reduced-motion`, there is no wipe and no slide, only a 150 ms fade.
- The native window just appears; it has no native animation.

## Consequences

- **Positive:** the first thing on screen is the final glass window, and the app arrives in one motion. Only `clip-path`, `transform` and `opacity` animate, once.
- **Negative:** when `ready` takes longer than 2.5 s (slow `detect_agents`, see `docs/PERFORMANCE.md`), the window appears empty in its glass for a moment, then reveals.
- **Accepted trade-off:** `window_ready` resolves after the native show, so the reveal can start one IPC round trip after the window appears. The app has no saved window size or position; Tauri's configured size is used as before.
- `tests/window-opening.test.ts` covers the once/ordering logic, reduced motion, the absence of the splash and the animated properties; `window_reveal.rs` tests `RevealOnce` and the fallback bound.

## Alternatives considered

- **Keeping the logo splash over the glass:** rejected by the owner; a splash that waits reads as a loading screen. The logo stays only as part of the reveal.
- **A native fade or zoom of the NSWindow:** it would fight the web reveal, and AppKit's window animations do not compose with a clip-path wipe.
- **Showing the window from `DOMContentLoaded`:** too early. The UI is still empty and its appearance is not yet known.

## 2026-10-08: show at launch

On the owner's Mac the first ready paint took longer than the 2.5 s fallback. The window then appeared through the fallback with the page's opaque `#0c0c0c` body over the glass, and it looked like a black window. Now the main window shows at launch (`window_reveal::show_at_launch`), right after its glass is applied. `index.html` keeps the page transparent, and the Sirus logo sits on the glass from the click (`data-opening="pending"`). When the app is ready, the content wipes in from left to right and the logo fades. The fallback timer is gone, because the window no longer waits.

## 2026-10-08: the window reopens where it was left

As in MonoCode, `tauri-plugin-window-state` saves the main window's size, position, and maximized and fullscreen state when the window closes or the app quits, and restores them on the next launch. Visibility is excluded (`StateFlags::all() - VISIBLE`), so the window still shows only after its glass is applied. The floating Astro chat is on the deny list because it keeps its own size.

## 2026-10-08: the launch paints the last look

The native glass was in place at launch, but the page painted the opaque theme background until settings arrived from Rust and `data-window-glass="on"` was set. So the logo sat on black, and the glass appeared only once the app loaded. Now `applyAppearance` keeps the applied look (dataset flags and CSS variables, without the chat background blob URL) in `localStorage` (`sirus.appearance`). `public/appearance-boot.js` restores it before the stylesheet paints. It is a file because the CSP allows only `'self'` scripts. This is how MonoCode restores its theme at launch. The very first launch after this change still paints the default once.
