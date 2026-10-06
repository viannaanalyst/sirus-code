# ADR-067: Sirus Code rebrand and legacy data move

**Status:** Accepted

## Context

The product was renamed from Switchyard to **Sirus Code**, with a new silver "S" orbit mark. The bundle identifier was part of the name (`com.switchyard.app`). Tauri derives the app-data directory from that identifier, so changing it would otherwise start the app with no projects, sessions, drafts, skills or provider profiles.

Isolated worktrees record their absolute paths in several places outside the state file: Git's own worktree links in each project's `.git/worktrees/`, exact native threads bound to a canonical cwd, and Claude Code's per-cwd session store. Rewriting those paths is not something the app owns.

## Decision

- **Identity.** `productName` is `Sirus Code`, the identifier is `com.siruscode.app`, the crate is `sirus-code` (lib `sirus_code_lib`) and the npm package is `sirus-code`. Internal names follow (`SirusClient`, `SIRUS_*` environment variables, `sirus_browser` / `sirus_computer` MCP servers, `sirus.session:` notification identifiers, the default branch pattern `sirus/{session-name}`).
- **Data move (`legacy_data.rs`).** At startup, when the new app-data directory has no `state.json` and `~/Library/Application Support/com.switchyard.app/state.json` exists, every entry except `worktrees/` is moved by rename. `state.json` moves last, so an interrupted move resumes on the next launch. The move is skipped when a debug `SIRUS_DATA_DIR` override is set.
- **Worktrees stay.** The legacy `worktrees/` folder is left in place and remains an owned root (`legacy_data::worktree_root`), so existing isolated sessions keep working unchanged. New isolated worktrees go under the new directory.
- **Project skills.** `.sirus/skills` is the project skills folder; the previous `.switchyard/skills` is still read.
- **Artwork.** The bundle icon, the embedded Smoked Glass and White Dock alternatives, the in-app glyph and the favicon derive from the owner's mark. The 16–64 px bundle sizes use a higher-contrast copy of the mark. Dock selection stays the closed set from ADR-033: no user-supplied icon path or image.

## Consequences

- **Positive:** existing data survives the rename without rewriting paths that Git or provider CLIs own.
- **Negative:** macOS treats the new identifier as a new app. Microphone, speech, Accessibility, Screen Recording and notification permissions must be granted again. Notifications delivered by the old app no longer route to sessions.
- **Accepted trade-off:** a `com.switchyard.app/worktrees` folder lingers until its sessions are cleaned up. Existing settings keep their saved `switchyard/{session-name}` branch pattern.

## Alternatives considered

- **Keep `com.switchyard.app`.** Safe, but leaves the old name in the data path, permission prompts and Activity Monitor.
- **Move worktrees and rewrite paths.** Requires `git worktree repair` in every project and breaks exact Claude resumes keyed by cwd.
- **Symlink the old directory.** Canonical path checks would resolve to different paths than the stored ones.
- **A user-supplied icon file, as Ghostty's `macos-icon = custom` offers.** Rejected: the renderer may not pass images or paths to the Dock (ADR-033). Ghostty's model of a fixed set of hand-made alternatives is what Sirus Code already uses.
