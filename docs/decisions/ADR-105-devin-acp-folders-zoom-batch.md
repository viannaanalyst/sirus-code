# ADR-105: Devin and Hermes through ACP, project folders, and image zoom

**Status:** Accepted (2026-10-09)

## Context

MonoCode's latest release and the owner's requests brought a batch:

- Devin ran as a print adapter: Auto only, no planning, no resume, and no answer to its permission requests.
- The project switcher had no way to group projects, for example a client's.
- Images in the lightbox could not be zoomed.
- The composer's macOS spelling could not be turned off.
- Large streamed code blocks were re-highlighted whole on every delta.
- Reply tables squeezed file names in narrow panes.

## Decision

- **Devin through ACP** (`devin.rs`, `devin acp`):
  - Native sessions start with `session/new` and resume exactly with `session/load` (`NativeThread`). The app's MCP servers are passed like OpenCode's (`opencode::acp_mcp_servers`).
  - Modes map to Devin's own:
    - planning runs in `plan`, which denies writes;
    - Full access runs in `bypass`;
    - Ask and Auto run in `accept-edits`: Devin accepts edits and asks before commands.
  - Model and reasoning use `session/set_config_option` and must be confirmed. Reasoning is sent only when the model offers it.
  - Permission requests become Sirus requests (command, file change, or tool). Each is answered with the once-only option; an "always" option is never chosen. Stop and cancellation reject leftover requests, then send `session/cancel`.
  - Devin's stderr logs are drained, never shown.
  - The CLI's own sign-in is used; Sirus starts no login. Account usage and limits are not read yet.
- **Hermes Agent** (Nous Research) is a provider through the same module (`acp_cli.rs`, `hermes acp`), after MonoCode.
  - Modes: Ask and planning run in `default` (Hermes asks for every tool; planning also denies writes), Auto in `accept_edits`, Full in `dont_ask`. They are set with `session/set_mode`.
  - The model is set with `session/set_model`.
  - Its catalog comes from a probe session (`models.availableModels`).
  - Setup failures point to `hermes model`.
- **Terminal surface.** The terminal pane no longer paints its own colour. xterm takes the first painted background around it (`terminal-surface.ts`), so beside a started conversation it matches the dock's sidebar material instead of a fixed `#0c0c0c`. A translucent surface keeps its tint at zero alpha.
- **Pasted Finder files.** `pasted_file_path` resolves file reference URLs explicitly and refuses non-local hosts. NSURL already resolved them; a test now pins the rename case.
- **Project folders.**
  - Stored in `settings.projectFolders` (`{ id, name, look, projectIds, collapsed }`, at most 64). They are display only: nothing moves on disk.
  - `sidebar::validate` bounds them and checks their look with `project_look::validate_look`. `normalize` keeps only existing projects, each in one folder.
  - The switcher lists each folder (collapsible) with its projects indented, then loose projects. A search opens the folders that contain matches.
  - Folders are created from "New folder" or a project's menu ("New folder with this project", "Move to …", "Remove from …"). Dragging a project onto a folder moves it in.
  - A folder's icon uses the project picker, now the shared `LookPicker`: emoji, line icon, Astro, or an image through `pick_look_image`, a native picker that returns a 96 px PNG data URL.
- **Switcher on hover.**
  - Pointing at the project title for 140 ms opens the switcher. Opened that way, it closes 280 ms after the pointer leaves both the title and the switcher, unless the person used it.
  - It does not take focus from the composer.
  - The separator between the project and its tabs is the tabs' thin vertical rule.
- **Lightbox zoom** (`image-zoom.ts`):
  - trackpad pinch (WebKit gestures, or ctrl+wheel);
  - ⌘ + wheel, the + / − / 0 keys, and double click, all around the pointer;
  - dragging or scrolling pans a zoomed image, clamped to its edges.
- **Autocorrect.** `composerAutocorrect` (Chat behavior, on by default) sets `spellcheck`/`autocorrect` on the session and Astro composer.
- **Streamed code.** `codeChunks` splits code over 2000 characters into chunks of about 40 lines, cut only outside a token. Each chunk renders memoized, so a growing block re-highlights only its last chunk.
- **Tables.** Cells keep a 7.5 rem minimum (6 rem for the first column) and inline code does not wrap. Narrow panes scroll the table sideways.
- **Message bubble.** The bubble is compact (option B) and wraps greedily (`text-wrap: wrap`). A measured "hug" width was tried and removed: rows rendered under `content-visibility` measured wrong, and WebKit's `pretty` wrapping had caused the empty strip in the first place.

## Consequences

- A Devin session now behaves like an OpenCode one: approvals, planning, resume and model choice. Its account usage is still not shown.
- Folders and their icons travel with settings, so they are kept per user and validated natively. A data-URL logo can make `state.json` grow by up to 96 KB per folder.
