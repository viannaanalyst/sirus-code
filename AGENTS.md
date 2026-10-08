# AGENTS.md

Sirus Code is a desktop app for running coding agents (Claude Code, Codex, OpenCode, Cursor, Grok and more) side by side: **projects → sessions → agents → worktrees → reviewable changes**. It is a Tauri 2 app with a React 19 + TypeScript front end and a Rust back end.

Small and focused changes land best. Use your judgement; when something looks wrong, fix it or say so.

## Get it running

You need Node.js 22.18+, a current stable Rust toolchain, Xcode command line tools on macOS, and at least one provider CLI installed and logged in.

```bash
npm install
npm run tauri dev       # the real app
npm run build:desktop   # local macOS debug app bundle
```

## Where things live

- `src/client/` — the client the UI talks to (`SirusClient`) and its transport; `LocalTransport` is the only place that calls Tauri directly.
- `src/store/app-store.ts` — the Zustand store (projects, sessions, layout, realtime events).
- `src/components/` — product UI, grouped by surface (`astros/`, `automations/`, `pull-requests/`, `tasks/`, …).
- `src/lib/` — pure helpers and shared logic, with tests in `tests/`.
- `src/styles/` — design tokens (`index.css`) and per-surface styles.
- `src-tauri/src/` — the Rust side: one module per area (`commands.rs` for IPC, `agent.rs` / `codex.rs` / `claude.rs` / `opencode.rs` for providers, `git*.rs`, `worktree.rs`, `persist.rs`, `astros.rs`, …).

For the full map — every module, the domain model, IPC commands and events, provider argv, Git and security choices, design system and performance notes — see [`docs/development/architecture.md`](docs/development/architecture.md). Decisions and their reasons are in [`docs/decisions/`](docs/decisions/README.md).

## Before you push

```bash
npm run typecheck && npm run lint && npm test
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

`npm run build` checks the production bundle when the UI changed. If structure changed, refresh the code map with `graphify update .` (outputs in `graphify-out/`; `graphify query "…"` answers architecture questions).

## Working notes

- Keep shared types aligned between Rust `models.rs` and `src/client/types.ts` (`camelCase` JSON).
- Persistence is JSON in the app data folder (`state.json` plus one `sessions/<id>.json` per session).
- The owner often works in the repo at the same time: format only the files you touched.
- Ask before destructive Git operations (force-push, `reset --hard`, deleting branches or worktrees).
- Notable features get a short ADR in `docs/decisions/`, and the architecture reference is updated when the map changes.
- UI follows the tokens in `src/styles/index.css` and the motion and popup patterns described in the architecture reference; new popups animate in and out. Labels are never forced into capital letters (no `uppercase`).
- Documentation is in English; the product UI is localized (English and Portuguese).
- Project skills live in `.sirus/skills/`.
- Design previews (HTML mockups to choose a direction) are temporary: build them outside the repo (for example under `/tmp`), never commit them, and delete them once the owner has chosen. `previews/` is ignored.
