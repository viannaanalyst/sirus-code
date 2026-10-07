# ADR-081: Phone app

**Status:** Accepted

## Context

ADR-080 serves the Sirus UI to paired devices. On a phone, the Mac layout does not fit: a sidebar, a right dock, popovers and a window header built for 1,000+ points of width. The owner approved a phone design with eight screens: Home, Projects, Conversation, New conversation, Review changes, Approval, Terminal and Connect. The design follows T3 Code's mobile app, where projects and their options stay visible. Stage 3 of the mobile plan builds it as a web app the Mac serves, installable from Safari (a PWA) without the App Store.

## Decision

**A separate shell over the same store.** `main.tsx` mounts `MobileApp` (lazy) instead of `App` when the UI is remote (`isRemoteUi`) and the viewport matches `(max-width: 820px)`. Tablets and wide windows keep the Mac layout. Both shells use the same `useAppStore`, `bindRealtime`, `bootstrap` and native commands, so the phone has no second data model.

**Navigation.**

- Four tabs: Home, Projects, Astros (added in ADR-082) and Settings.
- The tab bar is a floating Liquid Glass capsule (iOS 26 sizes: 62 pt tall, 21 pt from the edges), made with CSS alone (blur, saturation, a top rim and a specular edge). Safari does not apply SVG refraction. New conversation is a round glass button floating above the bar's right end. Tab pages scroll under both. The page behind the app wears the app's background, so a strip iOS leaves unpainted at the bottom of home-screen apps does not show as a black band.
- On top of the tabs sits a stack of full-screen pages (conversation, review, terminal) and one bottom sheet (new conversation).
- The browser history mirrors the stack (`pushState` with a depth), so the system back gesture closes the top page. Starting a conversation replaces the sheet with that conversation.
- Pages slide in from the side and the sheet from below. Reduced motion turns this off.

**Screens.**

- **Home.** One inbox across projects (`homeSections`): what needs the person, then work in progress, then the most recent conversations. Waiting status or pending requests put a conversation in the first group; badges are Approve, Question, Working, Failed and Stopped. A search box filters by title, project and branch, and a floating button starts a conversation. The Home tab shows a count of what needs the person.
- **Projects.** Each project shows its chosen look (`ProjectGlyph`), its status and its count of conversations. A project opens in place to list them, with "New conversation here".
- **Conversation.** The Mac's own `SessionPane`: the timeline, approval and question cards (`AgentRequests`), reply choices and the composer. It sits under a phone header (back, title, project · branch, terminal, review). CSS scoped to `.mobile-chat` fits it to the width and hides the message trail. The Approval screen of the design is these cards.
- **New conversation.** Project chips; provider defaults plus the newest two models of each installed provider (`latestModelChoices`); isolated worktree or project folder; the provider's approval modes; the first message. It creates the session (`createSession`), sends the prompt with the chosen approval and opens the conversation.
- **Review changes.** The dock's `ChangesPane`: files, diff, staging, commit (with the generated title) and push.
- **Terminal.** The dock's `TerminalTabsPane`, plus a row of keys a phone keyboard lacks (esc, tab, ctrl-c, arrows, `|`, `~`, `/`). The keys write to the active terminal.
- **Settings.** The connection state, this device and Disconnect. Mac-wide preferences (theme, language) stay on the Mac, because saving them from the phone would change the Mac too.
- **Connect.** Shown before pairing on any remote device. It lists the steps and has a field for the six-digit code. A home-screen app does not share Safari's storage, so it pairs again by typing the code shown under the QR on the Mac.

**Pairing codes are six digits** (was a 16-byte token in ADR-080). They can be typed, and they stay single use, valid for five minutes and withdrawn after five wrong guesses. That leaves at most five tries per code, from a device already on the person's tailnet. The QR link carries the same digits.

**Installable.** `index.html` links `manifest.webmanifest` (standalone, dark background) and full-bleed icons in `public/pwa/`. It sets `viewport-fit=cover` and Apple's home-screen tags, and the phone styles respect the safe areas. Web push and its service worker came in stage 4 (ADR-082).

## Consequences

- The phone gets every conversation feature the Mac has, through the same components. New desktop features reach the phone without porting, but they need a check at phone width.
- Store actions that save settings (for example selection memory) can write the phone's copy of the settings to the Mac. Phone screens avoid settings writes; a per-device preference layer can come later.
- The simulator stream and the native browser pane remain Mac-only.
- Web push needs HTTPS (`tailscale serve`) and a service worker; that is the next stage.
