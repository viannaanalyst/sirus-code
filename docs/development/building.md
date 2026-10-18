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

Format Rust with `cargo fmt` when you touch `src-tauri`. These checks are local; CI is not configured. The desktop script applies `tauri.local.conf.json`, generating a local debug app at `src-tauri/target/debug/bundle/macos/Sirus Code.app` using the configured `Sirus Code Local Signing` identity. This is not a notarized distribution/release. Verify the local artifact with `codesign --verify --deep --strict src-tauri/target/debug/bundle/macos/Sirus Code.app`. The existing `.app` identifier warning is retained to avoid changing the persisted app-data identity.

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

## Headless host (Linux server)

`sirus-host` runs Sirus Code without a window and serves the phone app ([ADR-131](../decisions/ADR-131-headless-linux-host.md)). On the server (Rust, a C compiler, Node.js 22.18+, Git, the provider CLIs logged in as the same user, and Tailscale up):

```bash
npm ci && npm run build                     # the UI → dist/
cd src-tauri
cargo build --release --no-default-features --features host --bin sirus-host
./target/release/sirus-host serve --ui-dir ../dist
./target/release/sirus-host pair            # in another shell: code + QR for the phone
```

`serve` listens on the machine's Tailscale address by default (`--bind` to choose; it never listens on every address unless told to with `0.0.0.0`), port 7710 (`--port`). State lives in `~/.local/share/sirus-code` (`--data-dir`, or `SIRUS_DATA_DIR`). `sirus-host devices` lists paired devices and `sirus-host revoke <id>` removes one. For HTTPS (needed for an installed phone app with alerts), run `tailscale serve --bg 7710` with `--bind 127.0.0.1`; the host shows the `https://<machine>.<tailnet>.ts.net` link (`tailscale set --operator=$USER` lets a non-root user manage it). Provider CLIs are found on `PATH`, `~/.local/bin`, `~/.npm-global/bin`, `$NPM_CONFIG_PREFIX/bin` and nvm's Node versions.

Checks for the host build: `cargo clippy --no-default-features --features host --all-targets -- -D warnings` and `cargo test --no-default-features --features host`. From a Mac, `cargo zigbuild --no-default-features --features host --bin sirus-host --target aarch64-unknown-linux-gnu` cross-builds the Linux binary.

A systemd user unit is enough to keep it running:

```ini
[Service]
ExecStart=%h/sirus/sirus-host serve --ui-dir %h/sirus/ui
Restart=on-failure
[Install]
WantedBy=default.target
```

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

## Native iPhone app

A React Native / Expo app in `mobile/` ([ADR-135](../decisions/ADR-135-react-native-iphone-app.md)). It needs Xcode, an iPhone and a free Apple ID (Personal Team).

```bash
cd mobile
npm install                          # also applies the patches and copies GhosttyKit (GHOSTTY_KIT_DIR)
npx expo prebuild --platform ios --no-install && (cd ios && pod install)
xcodebuild -workspace ios/Sirus.xcworkspace -scheme Sirus -configuration Release \
  -destination 'generic/platform=iOS' -allowProvisioningUpdates build   # then devicectl install
npm run publish:update               # JavaScript-only changes reach the installed app from this Mac
```

`mobile/.env.local` (untracked) holds `SIRUS_UPDATE_URL`, the Mac's `https://….ts.net/api/app-update/manifest`. Bump `RUNTIME_VERSION` in `mobile/app.config.ts` when native code changes. The LaunchAgent `com.siruscode.renew-iphone` runs `mobile/scripts/renew-iphone.sh` to renew the 7-day signature over Wi-Fi. The first time, enable Developer Mode on the iPhone and trust the developer under Settings → General → VPN & Device Management.

## Releases

`npm run release -- <version>` publishes a release from this Mac ([ADR-140](../decisions/ADR-140-in-app-updates-and-releases.md)): it checks that `main` is clean and up to date and that the version is newer, bumps `package.json`, `tauri.conf.json`, `Cargo.toml` and `Cargo.lock`, runs the checks (skip with `--skip-checks`), builds the release `.app` and DMG with a signed update archive, writes `latest.json` (notes from `--notes "…"` or the commit subjects since the last tag), commits "Release vX.Y.Z", tags, pushes and creates the GitHub release with `SirusCode-arm64.dmg`, `SirusCode-arm64.app.tar.gz`, its `.sig` and `latest.json`. `--dry-run` does everything but commit, tag, push and upload; the files land in `src-tauri/target/release-upload/vX.Y.Z/`. It needs `gh` signed in.

The update signing key is `~/.config/sirus-code/updater.key` (no password; `SIRUS_UPDATER_KEY` or `--key` point elsewhere, `SIRUS_UPDATER_KEY_PASSWORD` if it has one). Keep a backup: without it installed apps cannot accept new updates. Only its public half is in `tauri.conf.json` → `plugins.updater.pubkey`; key files are ignored by Git.

The app is signed with "Sirus Code Local Signing" when that identity is in the keychain (ad-hoc otherwise; `APPLE_SIGNING_IDENTITY` overrides) and is not notarized, so a downloaded DMG opens the first time through System Settings → Privacy & Security → Open Anyway. To notarize, set `APPLE_SIGNING_IDENTITY` to a Developer ID Application identity and `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`, or `APPLE_API_KEY`, `APPLE_API_ISSUER` and `APPLE_API_KEY_PATH`.

The DMG window uses `src-tauri/icons/dmg-background.tiff` (660×400 plus @2x). The website's download button points at `releases/latest/download/SirusCode-arm64.dmg`. The website is the static `website/public/` folder, served by Cloudflare Workers static assets at siruscode.com and www (`website/wrangler.jsonc`); publish it with `cd website && npx wrangler deploy` (run it inside `website/`: from the repository root Wrangler would detect Vite and configure the app instead).
