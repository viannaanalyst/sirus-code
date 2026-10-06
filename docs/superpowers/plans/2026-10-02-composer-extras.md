# Composer Extras Implementation Plan

**Goal:** Match the reference's inline Add menu descriptions, add evidence-based Debug instructions and explicit native single-window image attachments, and correct goal/mode lifetimes.

**Architecture:** Keep the existing composer/store/Client boundary. Goal text is a bounded native Session field admitted through Send; unsent goal edits remain owner-scoped drafts. Debug is prompt guidance and never changes approval policy. ScreenCaptureKit's native single-window picker is the only capture admission: the renderer supplies a draft owner, never a window identity, PID, path or capture region. One image joins the existing bounded private attachment cache after ownership is rechecked.

**Tech stack:** Existing React/Radix, Tauri, Rust, objc2 and ScreenCaptureKit. No new library or frontend capability.

- [x] Inline title/description rows, current-state labels, localized accessible keyboard controls and mode chips. Preserve native files/folders and skill pickers.
- [x] Debug guidance follows observe/reproduce/investigate/fix/verify; planning and debug are mutually exclusive; both retain current permissions and remain selected until changed.
- [x] Persist a bounded goal on native Send and inject it into subsequent process prompts. Retain unsent edits on failure and restore the native goal after restart. Goal continuation preference was asked separately; default to manual sends if unanswered.
- [x] Add a closed owner-only capture command, native one-window picker, once-only/timeout cleanup, bounded JPEG conversion and attachment admission. Cancellation adds nothing. No automatic capture, polling, window control or app identity enumeration in IPC.
- [x] Test prompt policy, successful/failed send lifetimes, goal admission/restart bounds, picker completion safety and Client command arguments. Run TypeScript, lint, Node tests, native fmt/check/clippy/tests and frontend/desktop builds; update Graphify and architecture docs.

Synara source inspected: `ComposerExtrasPanel.tsx`, `useAppSnapWindows.ts`, `provider/debugMode.ts`, `provider/goalMode.ts`, and successful goal-continuation admission in `ProviderRuntimeIngestion.ts`. Sirus Code deliberately uses trusted native selection rather than renderer-selected window IDs. The goal includes user data without overriding host/provider instructions.

Verification: 180 Node tests plus localized SSR/PDF rendering checks, 241 native tests (18 existing platform/vendor tests ignored), TypeScript, ESLint, native fmt/check/clippy and frontend/locally signed desktop builds. Reviewer rechecked context ownership, mode guidance and once-only completion. The native OS picker has not been visually exercised in this session; browser preview covers the composer UI only.
