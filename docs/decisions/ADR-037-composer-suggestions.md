# ADR-037: Composer skill and workspace filename suggestions

**Status:** Accepted

## Context

The existing skill picker requires opening Add. Typing `/` or `@` should expose the same enabled workflows and actual workspace names while preserving draft ownership, the first-send session lifecycle and native filesystem authority.

## Decision

Standalone slash tokens open the native skill catalog through the existing Client API. Search and disabled filtering reuse the existing skill helpers. Selection completes the token where it was typed (2026-10-06: it used to move to the front); ADR-036 admission now reads a `/skill` token anywhere in the prompt, skipping slash words that are not catalog skills (paths, prose). The composer paints `/skill` tokens amber and `@file` mentions in the info colour through a mirror behind the transparent textarea text (`src/lib/composer-tokens.ts`), changing only colour so wrapping matches exactly. Unknown commands remain text; the host does not invent vendor commands.

The read-only `workspace_files(owner, query)` command accepts saved project/session IDs and a bounded query. Rust derives the project root before the first send or the session's canonical worktree thereafter. A foreign project/session pair, missing owner, changed root or shutdown rejects publication. Client/Transport remains the only frontend native boundary.

Empty queries list the root. Queries containing `/` browse the named directory and filter its children. Bare names search relative paths breadth-first on demand, with 64 results, 8,192 visited entries, 12 nested levels and a 150 ms elapsed traversal budget. The time budget is checked between filesystem operations; it does not interrupt a blocked OS read. Partial scans report truncation. Queries are at most 1,024 bytes, cannot be absolute, contain control characters/backslashes, traverse `.`/`..` or enter existing ignored directories. Suggestions omit symlinks, special files and unusable names. Directory paths are jailed and linked query components are refused. Concurrent external directory replacement retains the existing canonical-path inspection limitation; this is a names-only inspector, not a stronger OS sandbox.

Selecting a directory continues browsing; selecting a file inserts a relative `@path` token, quoted when needed. The host neither reads file contents nor adds an attachment. Providers interpret the visible reference under their existing tools and permissions. Picker/clipboard snapshots remain the separate ADR-018 flow.

The popup uses the existing nonmodal Popover material and browser occlusion marker. Focus stays in the textarea. Arrow keys navigate, Enter/Tab select, Shift-Enter remains a newline and Escape dismisses. Loading cannot turn an attempted selection into an accidental send; empty unknown-command results retain normal send behavior. IME composition suppresses suggestions. Edit-driven debounce and request identities discard stale owner/workspace/query results; no polling, background index or draft persistence changes are added.

## Consequences

- Skills are discoverable without opening a menu, with existing native invocation validation.
- Files are available before session creation and remain scoped to isolated worktrees afterward.
- Large workspaces can require a narrower query or directory navigation. References provide names rather than guaranteed file content or media support.
- One narrow read-only command expands IPC without filesystem plugins, process execution, arbitrary roots or new capabilities.
