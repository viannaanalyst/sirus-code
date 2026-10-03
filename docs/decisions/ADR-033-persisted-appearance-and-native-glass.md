# ADR-033: Persisted appearance and closed native glass controls

**Status:** Accepted

## Context

The approved Appearance design separates System, Light and Dark palette
preferences from sidebar and whole-window translucency. A CSS backdrop filter cannot blur the macOS desktop through an
opaque WebView. Native appearance must follow saved settings without introducing
a renderer-controlled AppKit, image, path or process bridge. Interface, code and
terminal typography also have different sizing and family requirements.

## Decision

Extend existing `AppSettings`, `save_settings` and `host_info`; retain the Client /
Transport boundary and command allowlist. Theme, font and Dock choices are closed
enums. Missing preferences receive defaults. Retained neutral `translucent`
migrates to Dark with window glass and its former opacity; incoming settings
accept only System, Light and Dark.
The legacy `glass` field has no native authority. Native saves reject invalid
sizes or opacity; loading retained numeric values normalizes them to defaults.

Dark and Light remember independent sidebar and whole-window glass preferences
and opacities. System resolves the current OS palette and uses that palette's
retained material preferences. Native-only support is exposed through HostInfo
rather than renderer platform guesses. Other platforms keep opaque surfaces.
The theme picker uses three native radio cards with split Light/Dark artwork for
System, a selected outline and localized labels. Translucency remains a separate
control, with Sidebar only and Whole window scopes.

An internal macOS module borrows the owned main NSWindow on the main thread,
sets an explicit AppKit appearance (or removes the window override for System)
and transparent WebView backing, and maintains one
owned behind-window NSVisualEffectView. Fixed 24px WindowServer background blur
follows MonoCode; dynamically resolved private symbols are optional and standard
AppKit material is the fallback. No renderer-selected blur radius or native
handle is accepted. Returning to solid restores the opaque background. Queued
save callbacks read the latest retained state instead of replaying a stale save.
Existing native ThemeChanged events reapply palette-specific materials; the
renderer subscribes to prefers-color-scheme changes without polling. Terminal
colors update with that resolved palette without restarting the owned PTY.

Dock selection changes only the running NSApplication icon. Default clears the
runtime override and restores the application's original bundle icon; Smoked
Glass and White use fixed embedded PNG alternatives with transparent outer
corners. The compact picker displays images with localized accessible names and
a selection outline, without visible captions. It does not rewrite the signed
application bundle or replace the original icon with a raw PNG. Startup restores
the retained choice.

Typography stores a native UI-font override, a closed custom UI family, and
independent code and terminal families/sizes. UI roles still scale proportionally
from the base size. Bundled fonts have local WOFF2 assets and original licenses;
installed-only families fall back to system UI/monospace. See
[font provenance](../development/bundled-fonts.md). Terminal changes update xterm
options and refit after font loading without restarting the PTY.

Menus, tooltips, popovers and dialogs share floating material tokens. Solid
Light/Dark surfaces stay opaque; supported glass blends the resolved elevated
color at 68–95% opacity with a fixed backdrop blur. Window tint is independent.
Global palette/control tokens remain opaque so buttons and badges retain contrast.
Started conversations use the same sidebar material once at the main-column boundary, with no dot-grid wallpaper or additional opaque child coat. New thread and pending handoff keep their existing landing background and orbits. CLI usage lives directly below the composer, sharing its width and responding to Environment/dock layout changes.
Full-window glass has one tint coat; Settings does not compound it with the app
under its portal. One Appearance restore action resets only that page's keys.

## Consequences

- **Positive:** Native desktop glass, independent typography and a persisted Dock
  choice within the existing settings authority; no remote font origin or new
  command/capability.
- **Negative:** WindowServer blur is a private macOS API and can become
  unavailable. AppKit's fallback does not promise identical optical results.
  Installed-only fonts vary by computer.
- **Accepted trade-off:** Transparency and runtime Dock switching are macOS-only.
  A build and signature check cannot establish the native visual finish; that
  requires a later manual app inspection.

## Alternatives considered

- CSS-only glass cannot reveal the actual desktop through opaque native backing.
- Generic image/path/blur IPC expands the untrusted renderer's authority without
  helping these fixed preferences.
- CDN fonts introduce an unnecessary network dependency and CSP expansion.
- A separate neutral Translucent theme hides the palette/material relationship
  approved in the popup preview; translucency now belongs to each palette.
