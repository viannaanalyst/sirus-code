# ADR-095: Files pane keyboard navigation and text search

**Status:** Accepted

## Context

The Files pane tree only worked with the mouse, and there was no way to search text inside the project from the app. MonoCode 0.4 gives its file tree full keyboard navigation and a search field above the tree; the owner asked for both.

## Decision

- **Keyboard:** the tree is an ARIA tree (`role="tree"`, rows are `treeitem` with `aria-level`, `aria-expanded`, `aria-selected`) with roving focus: only the selected row is tabbable. ↑/↓, Home/End and PageUp/PageDown move the selection; → expands a folder or enters its first child; ← collapses it or moves to the parent; Enter and Space act like a click (files open, folders toggle). Typing a filename prefix jumps to the next match; letters within 700 ms form one prefix, and repeating one letter cycles. One `keydown` listener on the tree reads the visible rows from the DOM only when a key is pressed; the key logic is pure (`src/lib/file-tree-keys.ts`). File rows are memoized so moving the selection re-renders only the rows that changed. Keys typed in the inline new-file field never reach the tree.
- **Search:** a magnifier beside Collapse all opens an animated field under the pane header (Escape or the icon closes it, with a match-case toggle). From two characters, a 200 ms debounce calls `search_workspace_text`; results replace the tree, grouped by file with a count, and each line shows its number with the match highlighted. Clicking a match opens the file in the Files editor at that line and column (`CodeEditor` gained a `reveal` prop).
- **Native search** (`text_search.rs`): literal, scoped to the session's workspace like `list_dir`, run on a native worker. It uses `rg --json` when ripgrep is on the app's CLI PATH (`.gitignore` respected, binaries and files over 1 MB skipped, no link following). Without ripgrep it asks Git for tracked and untracked non-ignored files (`ls-files --exclude-standard`), and outside a repository it walks the tree itself, skipping `.git`, `node_modules`, `target`, `dist`, `build` and the other heavy folders, links and binary or large files. Every path is checked inside the canonical root before it is read. Bounds: 2,000 matches, 200 files, excerpts of 240 characters around the match, and 5 s, after which the process is killed and the result is marked truncated.
- **Remote:** the command is read-only like `list_dir` and `read_text_file`, so the phone may call it (not in `DENIED`).

## Consequences

- No new dependency: the `ignore` crate was not in the tree, so the fallback uses Git's own ignore rules instead of reimplementing them.
- Searches are one-shot, not streamed; very large repositories show the first results with a "refine the search" note.
- Lines are reported once each (the first match's column); the highlight marks every occurrence in the excerpt.
