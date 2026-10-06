# Synara Appearance mapping

Status: reference research inspected on 2026-10-02. The implementation boundary
is recorded in [ADR-033](../decisions/ADR-033-persisted-appearance-and-native-glass.md);
this document retains the reference mapping. The owner approved the material previews and then clarified the final
appearance model: **Dark, Light and Translucent are three independent modes**.
Translucent has one neutral glass palette, without a nested dark/light selector.
Dark and Light retain their approved standard palettes and optional translucent
sidebar. Dock icon choices and independent UI/code/terminal fonts remain in scope.

## Verified reference

The local [Appearance panel](../../../synara/apps/web/src/routes/_chat.settings.tsx)
uses Light/Dark/System previews and separate per-variant theme editors.
[ThemePackEditor](../../../synara/apps/web/src/components/ThemePackEditor.tsx)
contains color/preset controls, UI/code fonts, solid/translucent material,
sidebar-only scope, opacity, blur and contrast. Font override is ignored while
the separate system-UI-font preference is enabled.

| Control | Synara behavior | Sirus Code adaptation |
| --- | --- | --- |
| Theme | Light, Dark, System; per-variant theme packs | Keep the three modes, one standard palette per variant |
| Window material | Solid/translucent, then sidebar-only switch | One closed selector: Solid, Translucent sidebar, Translucent window |
| Opacity | 0–100%, saved separately for dark/light | Theme-specific tint opacity; hide control in Solid mode |
| Blur | Native automatic vibrancy or adjustable background blur | Start with the native standard material; do not promise an adjustable desktop-blur radius |
| Dock icon | Platform-specific visual choices; three stable macOS choices | Bundled Sirus Code variants, current/light/dark artwork; no renderer-selected path |
| UI font | Theme font input or system-font override | One global family selector, system default plus curated local/bundled choices |
| Code font | Per-theme monospace family | One global code/editor family, preserving the existing monospace fallback |
| Base text size | 11–18 px, default 13; UI/chat scale proportionally | Extend the existing shared typography scale without changing spacing |
| Terminal font | Suggested or typed installed monospace family | Independent local/bundled family selector, no remote font loading |
| Terminal size | 10–22 px, default 12 | Independent size; preserve Sirus Code's existing 13 px default |
| Density | Compact/default/comfortable; spacing independent of text size | Retain existing density control |
| Chat width | Standard/wide/full | Optional follow-up, separate from the requested visual material |
| Time format/smoothing | System/12h/24h and macOS font smoothing | Secondary follow-ups; not required for the first adaptation |

The table records the initial reference mapping. The owner's later three-mode
decision supersedes its Light/Dark/System theme selector and theme-specific
whole-window glass proposal. Translucent mode must style dropdown triggers,
dropdown content, menus and popovers with the same neutral glass material,
maintaining readable contrast instead of inheriting the opaque dark controls
seen in the browser preview. Do not change the approved preview for this
clarification; implement it in the real Appearance page.

Synara's [theme domain](../../../synara/apps/web/src/theme/theme.logic.ts)
stores scope/tint separately per variant. Default tint is 72% dark and 38% light,
with sidebar-only enabled and automatic blur. These are reference values,
not verified Sirus Code visual defaults.

## Baseline inspected before implementation

[SettingsPanels](../../src/components/settings/SettingsPanels.tsx) already exposes
Light/Dark/System, density, animations, reduced motion and 12/13/14 px UI sizing.
[applyAppearance](../../src/lib/settings.ts) applies CSS tokens and a shared
font scale. Terminal font size is independent, but terminal/editor family is
fixed to IBM Plex Mono. The `glass` preference currently does not create
desktop transparency: `.glass` uses a solid background.

[The native window](../../src-tauri/tauri.conf.json) is configured opaque, and
the layout paints opaque backgrounds. CSS opacity alone therefore cannot show
the desktop. The main sidebar and settings sidebar must share material tokens;
whole-window mode also needs content/dock/header surfaces to stop stacking
opaque or repeated translucent coats.

## Native feasibility and limits

Synara's [window material adapter](../../../synara/apps/desktop/src/windowMaterial.ts)
uses native under-window vibrancy by default. Its custom
[blur addon](../../../synara/apps/desktop/native/window-material/WindowMaterial.m)
calls the private `CGSSetWindowBackgroundBlurRadius` symbol and falls back to
vibrancy if unavailable. Electron-specific bridge/addon code is reference only.

The installed Tauri 2.12.1 provides
[native window effects](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindow.html#method.set_effects)
which require transparent window backing. Tauri's
[macOS configuration](https://v2.tauri.app/reference/config/#macosprivateapi)
documents the transparent-background feature. The precise backing configuration,
titlebar/traffic-light behavior, fullscreen and contrast must be checked in the
packaged app before claiming visual parity with MonoCode. Native API availability
is verified; the resulting Sirus Code visual effect has not been exercised.

AppKit's application-icon setter is present in the existing Objective-C binding.
A runtime Dock override can use embedded images and reapply a saved closed icon
ID on startup. This is separate from changing the installed app/Finder icon;
Synara additionally synchronizes its bundle icon. Do not modify the signed
Sirus Code bundle merely to change the running Dock icon.

## MonoCode glass reference

The owner approved the solid and sidebar-only dark/light previews and asked for
whole-window glass closer to the local MonoCode source. The reference was checked
in `monocode/src/features/settings/model/appearance.ts`,
`monocode/src/styles/index.css` and `monocode/src-tauri/src/macos.rs`.

MonoCode defaults to a neutral 9% lightness dark tint, 85% opacity and 24px native
desktop blur. Sidebar and body share the same tint instead of painting repeated
glass coats. Native glass is deliberately disabled in its light theme. Its macOS
implementation combines private `CGSSetWindowBackgroundBlurRadius` with a 1%
AppKit visual-effect backing to stabilize rendering. These facts do not establish
that Sirus Code's standard Tauri material will be identical.

The revised browser preview uses a single tinted, blurred window surface and
transparent content in whole-window mode. Its light glass is a Sirus Code design
extension, not behavior copied from MonoCode. Both effects remain simulations
over a browser backdrop; the application and native window remain unchanged.

The revised typography preview separates native-system UI override, curated UI
family, code family/size and terminal family/size. It includes 6 custom UI choices
and 12 monospace choices, with local fallback stacks for unavailable installed
fonts. Google Fonts is used only by the standalone browser study for its web-font
samples; product implementation must bundle any curated fonts it offers and must
not add remote font loading to the privileged application.

## Mapping constraints and layout

Use the existing Settings layout, Arc dropdowns/inputs, compact silver switches,
accessible preview selections and one Restore defaults action for Appearance.
No individual-row resets, hover tooltips, palette editor or theme import/export.

Keep preferences in the existing AppSettings JSON and store. Native effects,
theme and embedded-icon selection must run behind Client/Transport and typed
native validation. No frontend Tauri imports, generic paths/URLs, Electron
patterns, additional client stores or renderer-controlled native material flags.
Persist independent Dark/Light sidebar-material preferences and one Translucent
window-material preference; apply the selected mode consistently to native
chrome, UI and floating controls. Translucent has no dark/light child preference.

Existing animation/pointer/composer settings remain part of the page. Reset only
Appearance preferences; retain provider settings, Profile, sidebar organization
and references. Off macOS, report real platform support and retain readable
solid surfaces when native desktop translucency is unavailable.
