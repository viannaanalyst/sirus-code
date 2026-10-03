# Embedded Browser Phases 2–3 Implementation Plan (executed)

> Execute inline in the authorized checkout. No delegation, commit, push or computer use.

**Goal:** Finish the user-facing browser (Phase 2) and expose it to Codex, Claude and OpenCode as bounded MCP tools (Phase 3).

**Architecture:** Phase 2 adds fixed page scripts for find/link/screenshot/annotation/popups and a DOM overlay occlusion pass. Phase 3 runs a private Unix socket bridge in the app plus an `--mcp-browser` stdio MCP child of the same binary; adapters inject the endpoint per session.

**Tech Stack:** Existing WKWebView module (`browser.rs`), Tauri async runtime, tokio Unix sockets, Zustand/React, provider adapters.

## Constraints

- macOS-only browser; no new runtime dependencies; no Tauri IPC for page content.
- Allowlist http(s)/blank; `file:`/downloads/uploads unavailable; all tool values bounded and passed as data.
- Tokens only in 0600 files/env, never argv for Codex; constant-time comparison.
- No polling; occlusion driven by hit-testing and body mutations.

## Phase 2

- [x] Native: `browser_copy_link` (NSPasteboard), `browser_capture` (PNG snapshot ≤8 MiB, base64), `browser_find` (WKFindConfiguration, bounded query), popups/OAuth route to internal tabs (`WKUIDelegate`), `setInspectable` guarded by selector check.
- [x] Client/store: capture/copy/find actions, per-session bounded history (`noteBrowserUrl`), prompt-triggered screenshot attached to the sending turn without changing synchronous draft capture.
- [x] `BrowserPanel`: copy-link/capture/find buttons, find bar with Enter/Shift+Enter/Esc and found/no-match status, history + tab suggestions dropdown, local-servers home for blank tabs, favicon extraction (`link[rel=icon]`), compact active-tab pill and native tooltips.
- [x] Occlusion: five-point hit test plus body-portal `MutationObserver` hides the native view under dialogs/menus (Settings, dock `+`), restoring bounds when the overlay closes.
- [x] Checks: 130 Node tests, typecheck/lint/build green; bundle signed and smoke-tested by the owner.

## Phase 3

- [x] `browser_mcp.rs`: endpoint registry, `init` in `lib.rs` setup, `0700` directory + `0600` socket bridge with constant-time tokens, newline JSON framing, session ownership revalidation, `--mcp-browser` stdio MCP child (`initialize`, `ping`, `tools/list`, `tools/call`, `-32601`), image + `isError` content.
- [x] `browser.rs` page actions: document-start bridge script (human-input timestamps, bounded console buffer), `callAsyncJavaScript` with JSON-string arguments, snapshot/click/type/scroll/logs, `mcp_*` operations (status/open/navigate/back/forward/reload/capture/close).
- [x] Tools: 14 fixed definitions with bounded inputs and args validation (`valid_ref`, `valid_selector`, action result mapping, human interruption).
- [x] Injection: Claude `--mcp-config` 0600 file; Codex `-c mcp_servers.switchyard_browser.*` with token env; OpenCode `mcp` entry merged into its inline config. Other adapters unchanged.
- [x] Checks: `cargo fmt/check/clippy/test` green (186+ tests), stdio protocol exercised against a fake bridge (initialize, tools/list, screenshot image, `isError`, unknown method), signed bundle relaunched.

## Interfaces

`browser_mcp::init(app, data_dir)`, `browser_mcp::ensure_endpoint(session_id)`, `browser_mcp::claude_mcp_config(session_id)`, `browser_mcp::run_stdio()`; child env `SWITCHYARD_BROWSER_SOCKET` / `SWITCHYARD_BROWSER_TOKEN`.

Bridge frame: `{id, token, tool, arguments}` → `{id, ok, result|error}`. MCP tools listed in ADR-030.

## Verification

- [x] Node: typecheck, lint and 130 tests pass.
- [x] Rust: fmt/clippy clean; unit tests for policy, favicon, annotations, MCP tool defs/validation; stdio MCP manual protocol run.
- [x] Signed desktop build; app relaunch smoke.
- [ ] Owner runs a real Codex/Claude/OpenCode turn using the browser tools end to end.
