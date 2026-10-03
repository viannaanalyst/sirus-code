# Embedded Browser Phase 1 Implementation Plan

> Execute inline in the authorized checkout (this tree is not a Git repository: no commits, push or delegation). Follow AGENTS.md, ADR-029 and the existing RightDock/Client/Transport patterns.

**Goal:** A per-session browser pane in the right dock with tabs, an address bar and real navigation, backed by a native WKWebView that Rust owns.

**Architecture:** `browser.rs` (macOS) creates one `WKWebView` per tab with `objc2-web-kit`, adds it as a subview of the Tauri window's `contentView` and drives it from the main thread via `AppHandle::run_on_main_thread`. The React pane measures its viewport and sends logical bounds; Rust converts to AppKit coordinates and sets the frame, hiding or parking the view when the pane is unmounted or occluded. Navigation is allowlisted in a `WKNavigationDelegate`; state changes emit `browser-state`. Page content has no Tauri IPC, and downloads are refused.

**Tech Stack:** Tauri 2, objc2/objc2-web-kit 0.3.2, block2, existing Client/Transport and Zustand store, existing RightDock panes.

## Constraints

- macOS-only module with `#[cfg(not(target_os = "macos"))]` stubs; commands stay registered on every target.
- Every WebKit/WKWebView call runs on the main thread. Never hold the browser manager lock while dispatching to the main thread (deadlock); no blocking on a main-thread closure that itself waits on the caller.
- Allowlist for top-level navigation: `http:`, `https:` and `about:blank` only. Refuse `file:`, `data:` documents and every custom scheme. Downloads are cancelled (`WKNavigationActionPolicy::Cancel` when `shouldPerformDownload`).
- No Tauri capability/permission changes: the browser page is not a Tauri webview and has no IPC. No `shell`/`fs` plugins. Popups and OAuth windows are out of Phase 1 (no `WKUIDelegate`; `window.open` is a no-op).
- No polling: navigation state comes from delegate callbacks; bounds come from `ResizeObserver`/`rAF` bursts, not timers.
- Follow existing dock panel styling and typography roles; no new colors, durations or font sizes. New strings through `ui-strings.ts`, pt-BR.
- Tests cover pure functions only (URL policy, AppKit frame conversion, tab state machine); live WebKit is macOS main-thread-only and stays out of unit tests.
- No new dependencies beyond `objc2-web-kit` (same objc2 0.6 family already used). No `webkit` crate (offscreen, no NSView accessor).

## Tasks

- [x] Add `objc2-web-kit` (features: `std`, `objc2-core-foundation`, `objc2-app-kit`, `block2`, `WKWebView`, `WKWebViewConfiguration`, `WKWebsiteDataStore`, `WKNavigation`, `WKNavigationDelegate`, `WKNavigationAction`, `WKNavigationResponse`, `WKPreferences`, `WKScriptMessage`, `WKUserContentController`, `WKUserScript`) to `src-tauri/Cargo.toml`; create `src-tauri/src/browser.rs` with `is_allowed_browser_url`, `appkit_frame(content_height, bounds)` and `BrowserTabState`/`BrowserSessionState` serde models plus unit tests; register the module in `lib.rs`. (Temporary module-level `allow(dead_code)` is removed by Task 2.)
- [x] `browser.rs` manager: `BrowserManager` keyed by session id with `SessionRuntime { content_view: Retained<NSView>, tabs: Vec<TabRuntime>, active: Option<String> }`; main-thread-only `thread_local` state (no `Send` wrappers) with `try_borrow` guards; `create_tab` builds `WKWebViewConfiguration::new(mtm)`, default persistent `WKWebsiteDataStore`, `initWithFrame:configuration:` at a 1×1 offscreen frame, `content_view.addSubview(&webview)`, `setHidden(true)` and `setFrame` from the last known bounds; `drop_tab` removes the view (`removeFromSuperview`), clears the delegate and releases it.
- [x] `browser.rs` navigation delegate (wry reference: `~/.cargo/registry/.../wry-0.57.0/src/wkwebview/class/wry_navigation_delegate.rs`): `define_class!` with `#[unsafe(super(NSObject))] #[thread_kind = MainThreadOnly] #[ivars = BrowserDelegateIvars]`, implementing `WKNavigationDelegate` for `decidePolicyForNavigationAction` (allowlist + download cancel), `didStartProvisionalNavigation`, `didCommitNavigation`, `didFinishNavigation`, `didFailNavigation:withError:` and `didFailProvisionalNavigation:withError:`. Callbacks read `webview.URL()`, `webview.title()`, `can_go_back()`/`can_go_forward()` on the main thread, update the manager and `app.emit("browser-state", state)`; set `browser-state` also on tab create/close/select and on `didFinish`.
- [x] IPC in `commands.rs` + registration in `lib.rs`: `browser_open`, `browser_close`, `browser_state`, `browser_new_tab`, `browser_close_tab`, `browser_select_tab`, `browser_navigate`, `browser_reload`, `browser_back`, `browser_forward`, `browser_set_bounds`. Each resolves the main window's `ns_window()` (via `WindowExtMacOS`), dispatches through a `on_main(app, closure)` helper that uses `run_on_main_thread` plus a bounded `mpsc` reply channel, validates session ownership against `AppState` sessions, and returns `BrowserSessionState`. `browser_set_bounds` accepts `Option<BrowserBounds>` (`null` = hide) and never errors on a missing tab.
- [x] Client/Transport + store: add `BrowserTabState`, `BrowserSessionState`, `BrowserBounds` to `src/client/types.ts`; client methods mirroring the commands plus `onBrowserState(handler)`; Zustand `browserBySession`, `loadBrowser(sessionId)`, `browserOpen`, `browserClose`, `browserNewTab`, `browserCloseTab`, `browserSelectTab`, `browserNavigate`, `browserReload`, `browserBack`, `browserForward`, `setBrowserBounds` (fire-and-forget, coalesced per session) with removal/prune on session deletion and no state for removed owners.
- [x] `src/lib/use-browser-bounds.ts` + `BrowserPanel` React component: hook measures the pane viewport with `getBoundingClientRect`, multiplies by the app/webview zoom factor if one applies, and sends a deduplicated bounds signature on mount, `ResizeObserver`, window resize, dock resize and short `rAF` bursts during transitions; sends `null` on unmount and when `document.hidden`. `BrowserPanel` renders the tab strip (title, close, middle-click close, `+`), back/forward/reload, address bar (Enter navigates through `normalizeBrowserAddressInput`; no autocomplete in Phase 1), loading spinner and a real error/empty state; typing is per-tab draft state.
- [x] RightDock integration: add `"browser"` to `DockPaneKind`, pane meta (`Globe`/`Compass` lucide icon, label "Browser"), launcher entry and `active.kind === "browser"` branch rendering the lazy `BrowserPanel`; the pane follows the selected session and shows the empty state when no session is selected; closing the pane or switching sessions hides the native view; the dock header keeps its existing collapse/maximize/resize behavior and bounds resync runs after dock transitions.
- [x] Hardening and docs: focus restore to the app webview when the view is hidden (`makeFirstResponder`), no downloads (verify a download link cancels), `file:///etc/passwd` refused, app shutdown destroys all tabs, session removal prunes browser state, no native view survives project removal. Run `cargo fmt/check/clippy/test`, `npm typecheck/lint/test/build`, rebuild/sign `npm run build:desktop`, smoke the pane in the app. Mark ADR-029 Phase 1 done, update `AGENTS.md` (IPC list, native modules, components, events), `docs/decisions/README.md`, `README`/backlog if needed, and run `graphify update .`.

## Interfaces

Rust commands (all `async`, all return the updated session state except where noted):

```rust
browser_open(session_id: String) -> Result<BrowserSessionState>
browser_close(session_id: String) -> Result<()>
browser_state(session_id: String) -> Result<BrowserSessionState>
browser_new_tab(session_id: String, url: Option<String>) -> Result<BrowserSessionState>
browser_close_tab(session_id: String, tab_id: String) -> Result<BrowserSessionState>
browser_select_tab(session_id: String, tab_id: String) -> Result<BrowserSessionState>
browser_navigate(session_id: String, tab_id: String, url: String) -> Result<BrowserSessionState>
browser_reload(session_id: String, tab_id: String) -> Result<BrowserSessionState>
browser_back(session_id: String, tab_id: String) -> Result<BrowserSessionState>
browser_forward(session_id: String, tab_id: String) -> Result<BrowserSessionState>
browser_set_bounds(session_id: String, bounds: Option<BrowserBounds>) -> Result<()>
```

Event `browser-state` carries `BrowserSessionState { sessionId, open, tabs, activeTabId }`; each `BrowserTabState { id, url, title, loading, canGoBack, canGoForward }`.

`BrowserBounds { x, y, width, height }` is logical (CSS px, top-left origin, relative to the window content area). Rust converts with `appkit_frame(content_height, bounds)` to AppKit bottom-left points.

TypeScript: `Client.browserOpen(sessionId): Promise<BrowserSessionState>` (and the mirrored methods), `Client.setBrowserBounds(sessionId, bounds: BrowserBounds | null): Promise<void>`, `Client.onBrowserState(handler): Promise<() => void>`. Store actions mirror the commands and dedupe bounds sends by signature.

## Verification

- [x] `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` pass (new URL-policy/frame/tab tests included).
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass.
- [x] `npm run build:desktop` builds and signs with MonoCode Local Signing.
- [x] Manual smoke: open Browser pane, navigate to an https site, open two tabs, switch/close tabs, back/forward/reload, hide/show the dock, switch sessions, open a menu over the pane (view hides), `file:///etc/passwd` refused, a download link does not write a file, Quit while the pane is open exits cleanly. Owner-confirmed: navigation, tabs, favicon, occlusion and annotation. `file://` is refused by the command allowlist and the navigation delegate; download cancellation is enforced in the delegate and still worth one explicit manual click.
- [x] No polling (no `setInterval` for state), no global `pointermove` listeners, no new capabilities, no renderer-supplied paths/executables.

## Phases 2–3 (own plans)

- **Phase 2 — rich interaction:** annotations overlay (named content world + script messages) into composer chips; copy link; prompt-triggered screenshot; persistent website data (cookies/storage) and a clear-data action; find-in-page; `isInspectable` (Safari Web Inspector) behind developer settings; local-servers home for blank tabs; OAuth/`target=_blank` popups as internal tabs.
- **Phase 3 — agent/MCP:** local `rmcp` streamable-HTTP MCP server bound per session/turn; injection into Claude (`--mcp-config` + `--strict-mcp-config`), Codex (`mcp_servers` with `bearer_token_env_var` in the bound profile) and OpenCode (remote `mcp` entry via its per-session config); tools `browser_status`, `browser_tabs`, `browser_open`, `browser_navigate`, `browser_back/forward/reload`, `browser_screenshot` (`takeSnapshot`), `browser_snapshot`, `browser_click`, `browser_type`, `browser_scroll`, `browser_logs`, `browser_close` implemented through native APIs and bounded injected JS; human-input interruption; output redaction; uploads and `browser_run`-style scripting only if requested later. Downloads stay out.
