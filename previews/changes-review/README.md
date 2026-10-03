# Turn changes review preview

Run `npx vite --config previews/changes-review/vite.config.ts`. Open **http://localhost:4195/**.

Three options: compact Synara list, MonoCode-inspired review card, and discreet collapsed line. Review/file clicks open the corresponding example's right diff; unified and paired displays use the same computed bounded example-text diff. Six example files demonstrate Show more. Completion vs running hides the settled summary while running.

The editor reuses the product's corrected CodeMirror and Markdown preview. Save/⌘S changes only in-memory example buffers. Unsaved content survives file/diff switches; closing the editor asks before discarding. Dark/Light/System and optional glass also apply to the confirmation popup.

Keep and Revert to message are **simulations**, clearly marked in the UI. No project files, native commands, providers, checkpoint refs or conversation state are read or changed. Option 01 is now integrated into the product with native historical diffs and Keep acknowledgments ([ADR-040](../../docs/decisions/ADR-040-native-turn-change-review.md)). The product has no turn checkpoint/rollback operations.

Optional automated regression: build with `npx vite build --config previews/changes-review/vite.config.ts`, then run `node scripts/verify-editor-preview.mjs /path/to/chrome-headless-shell`. It uses a temporary browser profile and local fixture-only server with nonce-only style CSP. Removing the editor's nonce via `--without-editor-nonce` intentionally makes the gutter/layout assertion fail, reproducing the reported stacked layout. No interactive application or user browser is accessed.

The selected default is option 01, Lista compacta, initially expanded, with Manter and Revisar actions and no turn-summary undo button. Its user-message Undo2 action appears on hover or keyboard focus, with the timestamp, and remains a mock rollback.

`layout-fixture.html` mounts the actual SessionPane and Sidebar with disposable in-memory owners. The optional browser regression verifies new-send top anchoring, short settlement, viewport resizing, long output following, manual history scrolling, and a bookmark jump clamped near the end. It also checks grouped folders/header controls, the continuous frame, and collapsed hover/pin controls. This second fixture admits the pinned shader package's one fixed stylesheet hash in addition to the nonce; it does not change product CSP. `--without-turn-reserve` is a negative control that must fail the top-anchor assertion.

The layout regression also clicks the Settings gear with both expanded and collapsed rails, asserting the original full SettingsPage opens directly. Back/Escape retains the prior main sidebar state and project selection.

It checks compact icon/title session rows without project/branch metadata or the activity scope/Projects add header, and real CLI usage alignment beneath the composer with collapsed navigation and an Environment inset. Solid, sidebar-glass and window-glass Dark/Light conversations share the sidebar material without a patterned or opaque child background; New thread and pending handoff retain their landing material and orbits. Native desktop blur still requires app inspection; this fixture checks CSS material selection and geometry only.

The transcript scrollbar stays hidden in standard and WebKit styling while the same real-component scroll tests verify send anchoring and manual navigation. The duplicate Projects rail button/panel is absent; Home still contains the owned project folders.

`layout-fixture.html?outline` opens a longer disposable conversation with the product's real left-edge message trail. Hover previews show each request and its reply; clicks navigate the actual transcript, and Tab/arrow/Home/End navigation uses one rail tab stop. The fixture's existing simulated admission/output controls can exercise detached history while replies grow. This mode starts with the sidebar collapsed to leave space for the rail; the rail hides below a 600px chat width.

The layout regression hovers a real session, opens its context menu, and enters Delete/Rename dialogs. It verifies no background hover card survives menu/modal focus, the delete button uses the danger material, the delete footer is compact, and Cancel/Escape perform no deletion.

This visual fixture disables `refreshProviderUsage` and has no native IPC host. Its “Usage unavailable” placeholder does not diagnose CLI installation, authentication or quota. The visible preview notice states this boundary; verify live usage in the desktop app.
