# ADR-084: Phone app on the device

**Status:** Accepted

## Context

Using the phone app (ADR-081) on a real iPhone showed problems that desktop emulation hides:

- A black band at the bottom.
- The page zooming and shifting when a field got focus.
- A code field hidden behind the keyboard.
- A blank screen when the Mac was out of reach.
- No dictation in conversations.
- Long radio lists in New conversation.
- No way to add an Astro.

## Decision

**Full height on iOS 26.** Home-screen apps on iOS 26 measure every height short by the status bar: `100%`, `100vh`, `100dvh`, `inset: 0`, `innerHeight` and `visualViewport` (WebKit 301108, still open in 26.6). Only `100lvh` reports the full screen.

- In standalone mode on iOS, the app root is sized `top: var(--app-top); height: var(--app-h)`, with `--app-h: 100lvh`. Elsewhere it uses `100dvh`.
- `html` and `body` share the height and the app's colour.
- The fix comes from projects that confirmed it on devices (for example AltanS/collie #355 and odysseus-dev/odysseus #6396).

**Keyboard.** `lib/mobile-viewport.ts` follows `visualViewport`.

- While the keyboard is open (more than 120 px of the screen), `--app-h` and `--app-top` follow the visible area, so the composer sits right above the keyboard. When it closes they are cleared and the scroll offset iOS leaves behind is reset.
- It measures again 70 and 240 ms after a change, because the keyboard animates.
- Phone fields are at least 16 px and the viewport sets `maximum-scale=1`, so iOS no longer zooms on focus. The code field scrolls itself into view.

**Dictation.** The Mac's microphone is out of reach from the phone, so `ComposerDictationButton` uses one of two engines:

- on the Mac, native dictation (ADR-027);
- in the UI served to a device, the browser's own speech recognition (`webkitSpeechRecognition`, which is Siri dictation on iPhone), with interim words in the recording strip.

The button, strip, Enter and Escape behave the same in both.

**Coming back to the app.** iOS suspends a home-screen app in the background, which drops its socket.
- Bringing it to the front reconnects at once (`visibilitychange` → `wakeRemote`).
- It used to reload the page after a lost connection, which replayed the splash each time and asked for dictation permission again. Now it refreshes the data in place (`bootstrap`), keeps the open conversation and reloads its transcript.
  - *2026-10-08:* the launch splash no longer exists; the desktop window opens in its glass look with a left-to-right reveal instead, and the phone simply shows the app when ready (ADR-098).
- It reloads only when the Mac serves a newer build: the served `index.html` no longer names the running script (`isNewerBuild`). That way updates arrive by themselves.

**Dictation sessions.** iPhone's recognizer stops hearing after the first session in continuous mode, so `WebDictation` listens in short sessions and starts the next one while the person is still recording. The phrases add up. A permission or service error stops it.

**Lighter loading.**
- The served app is compressed (gzip or brotli via `tower-http`): the entry script drops from about 1 MB to about 270 KB.
- Hashed `/assets/` files are sent as `immutable` for a year.
- `App` and `MobileApp` are separate lazy chunks, so a phone no longer downloads the Mac layout (sidebar, dock, editor) to show the phone app.

**Composer at phone width.** Approval shows only its icon (its name stays in its menu), the model name truncates, and the context meter is hidden.

**Dropdowns.** `MobileSelect` is a field that opens a glass menu with icons and a check. It opens toward the larger side and closes on an outside tap. New conversation uses it for Project, then Provider, then that provider's newest models or its default. The sheet closes with a round glass X instead of a text button.

**Rename and delete.** A ⋯ in the conversation header opens Rename and Delete, through `MobileMenu` and `MobileDialog`, with the Mac's rules: a working conversation cannot be deleted, and an isolated worktree is removed only when asked (refused if it has changes).

**Astros.** A + in the Astros header opens the New Astro sheet: name, icon, colour and project. It creates the Astro with `saveAstro` and opens its conversation. Its soul and memory stay on the Mac.

**Dock.** One glass pill glides to the chosen tab (`--tab-index`, springy easing; none with reduced motion), and a tapped icon presses in.

**Offline shell.** The service worker now keeps the app shell:
- pages are fetched from the Mac first, with the last copy as fallback;
- hashed assets are served from the cache;
- `/api/` is never cached.

A home-screen app opened while the Mac is out of reach shows the app reconnecting instead of a blank page.

## Consequences

- The iOS 26 fix depends on `100lvh` behaving as measured. If WebKit fixes the bug, `100lvh` still equals the full screen.
- iOS caches a home-screen app's viewport and manifest values when it is added. After this change the app needs to be removed and added to the Home Screen again, once.
- Speech recognition on the phone needs the network and the person's microphone permission. The text stays on the device until it is sent.
