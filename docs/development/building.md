# Building and running Sirus Code

## Requirements

- Node.js 22.18+ (repo verified with Node 26; Node built-in TypeScript test loading)
- Rust stable (built with 1.98)
- Git
- macOS is the verified V1 host
- Optional: `codex`, `claude`, `opencode`, `cursor-agent`, and/or `grok` on `PATH` to run agents

## Install and run

```bash
npm install
npm run tauri dev
```

Vite serves the UI at `http://localhost:1420`. Use the Tauri command, not the browser, for filesystem, Git, agents, and PTY.

## Checks (what exists today)

Typecheck covers application and test TypeScript. Node tests cover domain utilities, model selection and state races; Rust tests use real temporary Git repositories and owned subprocesses. ESLint focuses on bug detection and React hooks, not formatting.

```bash
npm run typecheck
npm run lint
npm test
npm run test:arc
node scripts/verify-general-settings.mjs
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run build:desktop
```

`npm run build` runs `tsc && vite build` (the frontend Tauri consumes).

Format Rust with `cargo fmt` when you touch `src-tauri`. These checks are local; CI is not configured. The desktop script applies `tauri.local.conf.json`, generating a local debug app at `src-tauri/target/debug/bundle/macos/Sirus Code.app` using the configured `MonoCode Local Signing` identity. This is not a notarized distribution/release. Verify the local artifact with `codesign --verify --deep --strict src-tauri/target/debug/bundle/macos/Sirus Code.app`. The existing `.app` identifier warning is retained to avoid changing the persisted app-data identity.

Tauri also merges `tauri.macos.conf.json` automatically on macOS. Its main-window array repeats the base dimensions/titlebar settings and enables transparent WebView backing for native Appearance. Keep both window definitions aligned when changing window configuration. Other targets use the opaque base window. Font assets and original licenses are bundled locally; see [font provenance](bundled-fonts.md) and [Appearance authority](../decisions/ADR-033-persisted-appearance-and-native-glass.md).

## Data on disk

- State index: `~/Library/Application Support/com.siruscode.app/state.json` (projects, settings, drafts, session metadata)
- Transcripts: `…/com.siruscode.app/sessions/<session-id>.json`, one per session ([ADR-047](../decisions/ADR-047-per-session-transcript-files.md))
- One-time migration backup: `…/com.siruscode.app/state.json.pre-split-backup`
- Isolated worktrees: `…/com.siruscode.app/worktrees/{project_id}/`

Removing a project from the sidebar deletes metadata only, not the user’s folder.

For isolated development validation, debug builds accept an absolute `SIRUS_DATA_DIR` environment variable. It changes state/worktree storage for that launched process only; release builds ignore it. Never launch a second instance against the same user state for a smoke test.

### Duplicate Spotlight entries

The fixed identifier `com.siruscode.app` also names the native data and WebKit
directories. macOS can mistake their `.app` suffix for an application bundle
and register them without an `Info.plist`. If search shows duplicate entries,
exclude only `~/Library/Application Support/com.siruscode.app` and
`~/Library/WebKit/com.siruscode.app` in Spotlight's **Search Privacy** list
([Apple instructions](https://support.apple.com/en-gb/guide/mac-help/mchl1bb43b84/mac)).
Unregister those two exact directory paths with `lsregister -u`, retaining the
real signed `Sirus Code.app` registration. Do not delete user data, reset the
entire Launch Services database, or change the persisted app identifier.

## Graphify

After structural code changes:

```bash
graphify update .
```

Full rebuild is rarely needed. See `AGENTS.md`.

## Opt-in provider smoke tests

These tests make real inference calls using existing CLI authentication, inside owned temporary Git/worktree fixtures. They are excluded from ordinary tests; no authentication files are changed. Run a specific provider intentionally:

```bash
cargo test --manifest-path src-tauri/Cargo.toml codex::tests::live_codex -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml claude::tests::live_claude -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml opencode::tests::live_opencode -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml live_opencode_workspace -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml live_cursor_analysis -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml live_cursor_workspace -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml live_claude_catalog -- --ignored --nocapture
```

The Codex and Claude native fixtures exercise exact continuation and host approval refusal; Claude also approves one reviewable Write. Legacy raw-CLI smoke tests remain opt-in. `SIRUS_SMOKE_MODEL` optionally selects an actual CLI model for the legacy workspace fixtures. Cursor uses Auto-review with sandbox enabled (requires a compatible CLI); the edit test verifies actual safe writes. `live_claude_catalog` initializes the CLI without a user prompt or inference. Tests cap execution, stop only their owned process group on timeout and assert the original checkout is unchanged. Passing does not guarantee all account models or every vendor permission flow.
