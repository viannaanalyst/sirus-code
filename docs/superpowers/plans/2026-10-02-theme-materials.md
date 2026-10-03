# Theme cards and independent materials

**Goal:** Implement the approved popup preview and the Synara-style System/Light/Dark theme cards.

**Architecture:** Existing settings own palette and per-palette material preferences. Native effects stay on the main thread; System follows AppKit/OS changes without polling. Shared floating-surface tokens cover menus, dropdowns, tooltips and dialogs without making header controls or badges translucent. No new IPC or capabilities.

**Execution:** Inline; the preview and current user instructions approve the design. This checkout has no Git metadata.

- [x] Migrate retained neutral Translucent to Dark with window glass, retaining its opacity. Add independent Dark/Light window preferences; preserve sidebar preferences. Validate bounded native settings and keep TypeScript/Rust aligned.
- [x] Resolve System through the native window's OS appearance and the media-query change event. Reapply native materials on System changes; update terminals without restarting PTYs.
- [x] Replace the theme dropdown with native radio cards (System split artwork, Light, Dark), selected outlines and localized labels. Offer per-palette translucency scope and opacity through existing controls.
- [x] Apply approved floating surfaces in solid and glass variants, preserving opaque text, buttons and badges. Keep unsupported hosts opaque.
- [x] Check legacy migrations, independent palette materials, System changes and real localized settings markup. Run frontend checks, native tests/fmt/strict Clippy, desktop build/signature, code review and Graphify incremental update.

**Verification:** Typecheck, ESLint, 144 Node tests and all real-component render checks passed. Rust: 206 passed, 17 pre-existing ignored; fmt and strict all-target Clippy passed. Desktop bundle built and its deep/strict signature verified. Independent code review reported no production findings. Graphify updated incrementally. Native visual finish was not inspected with computer use.
