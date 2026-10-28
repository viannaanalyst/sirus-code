# Sirus Code

A local-first desktop app for running coding agents side by side: Claude Code, Codex, OpenCode, Cursor, Grok and more.

**Projects → sessions → agents → worktrees → reviewable changes.**

![Sirus Code: a Claude session adding a dark mode toggle, with its changes open in the side panel](docs/assets/screenshot.png)

## Features

- **Many agents, one place.** Each session runs a provider CLI you already have installed and signed in to. Sessions run in parallel, across projects.
- **Isolated worktrees.** A session can work in the current checkout or in its own Git worktree, so agents don't step on each other.
- **Reviewable changes.** Every turn shows the files it changed. You can keep or undo them, open the diff, stage and commit from the side panel, and browse the commit graph.
- **Approvals and questions.** Agents ask before they act, at the access level you choose for each turn.
- **Terminal, files and browser.** Each session has a built-in terminal, a file viewer and a browser tab next to the conversation.
- **Usage at a glance.** See each provider's real quota and when it resets. Codex and Claude support several accounts.
- **Connectors.** Remote MCP servers (Supabase, Linear, Notion, Context7…), with OAuth sign-in handled by the app. They can be scoped to one project or to all of them ([ADR-137](docs/decisions/ADR-137-connectors.md)).
- **Phone and server.** Pair an iPhone with a QR code and follow or steer your sessions from it ([ADR-135](docs/decisions/ADR-135-react-native-iphone-app.md)). The back end also runs headless on a Linux server as `sirus-host` ([ADR-131](docs/decisions/ADR-131-headless-linux-host.md)).
- **Local data.** There is no Sirus account and no required cloud. State lives in one SQLite database in the app's data folder ([ADR-114](docs/decisions/ADR-114-sqlite-storage.md)). Each CLI keeps its own sign-in.
- **English and Portuguese** interface, with themes, adjustable text size and custom shortcuts.

## Requirements

- macOS (the main platform for now)
- Node.js 22.18+
- A current stable Rust toolchain and the Xcode command line tools
- Git
- At least one provider CLI, installed and signed in

## Development

```bash
npm install
npm run tauri dev       # the real app
npm run build:desktop   # local macOS debug app bundle
```

The Vite front end is served on `http://localhost:1420`, but the Tauri webview is the real environment.

The debug bundle is ad-hoc signed and is not notarized. To open it:

```bash
open "src-tauri/target/debug/bundle/macos/Sirus Code.app"
```

## Checks

```bash
npm run typecheck && npm run lint && npm test
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

## Getting started

1. Open Sirus Code and add a local Git folder as a project.
2. Create a session (⌘N), pick a provider and model, and choose the current checkout or an isolated worktree.
3. Send an instruction, then follow the output, the changes and the terminal.

Removing a project from the list never deletes files on disk.

## Documentation

- [`AGENTS.md`](AGENTS.md): how to work in this repository
- [Architecture](docs/development/architecture.md): modules, domain model, IPC, providers, Git and security
- [Runtime](docs/development/runtime.md) and [provider usage](docs/development/provider-usage.md)
- [Decisions](docs/decisions/README.md) and [all docs](docs/README.md)

## License

[MIT](LICENSE). Code adapted from other open source projects keeps its original notices in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
