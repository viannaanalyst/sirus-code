# ADR-102: Workspace UX batch — typing, glass terminal, diff find, reopen closed, PR bodies

**Status:** Accepted

## Context

Six small problems, most reported in comparable apps (T3 Code, Synara):

- Typing while nothing editable had focus moved every printable key to the composer, including Space and letters meant for a focused button, switch, tab or file-tree row. Each composer (main and side chat) added its own window listener.
- On window glass the terminal background was `#00000000`. xterm paints reverse video with the opaque form of the background, so selections and vim/less/fzf highlights turned black.
- Typing in the diff review comment box re-rendered every mounted diff row.
- There was no way to search inside a diff.
- Only header tabs could be reopened (tab menu and Undo toast); closed dock panes and browser tabs were lost.
- Pull request descriptions showed raw Markdown and HTML as plain text.

## Decision

- **Type to focus:** `typingGoesToComposer` (`src/lib/type-to-focus.ts`) redirects a printable key only when focus is on the page or a non-interactive container (the transcript). Inputs, buttons, links, `summary`/`details`, editable content, dialogs, menus, listboxes, trees, terminals and every ARIA control role keep their keys. `composerOwnsTyping` lets only the visible main composer of the selected conversation (or of the landing) take them; side chats never do.
- **Glass terminal:** `terminalAppearance` returns the theme's background at zero alpha (`#0c0c0c00` dark, `#f4f4f500` light), so reverse video uses the theme color. `terminalTransparent` sets xterm's `allowTransparency` only with window glass, and the option follows live changes.
- **Diff rows:** `DiffRow` is memoized with primitive or stable props (`t`, a ref-backed `onChoose`, per-line match ranges shared between renders), and the comment draft lives in `CommentForm`. Chunked mounting (`src/lib/diff-window.ts`) is unchanged.
- **Find in diff:** the find-in-conversation binding (⌘F by default) opens a small find bar over the diff when focus is inside the diff viewer, or the pointer is over it and no text field elsewhere has focus. A capture-phase listener claims the key there, so the transcript's ⌘F keeps working everywhere else. Matching (`src/lib/diff-find.ts`) is case-insensitive over every line, bounded to 2000 matches. Enter/↓ and Shift+Enter/↑ step through them; the current match mounts the chunks up to it (`diffCountFor`) and scrolls into view; Escape closes and returns focus to the diff. While searching, short untracked files show plain rows instead of the highlighted block, so matches can be marked. The bar uses the transcript find bar's style and entrance.
- **Reopen closed:** one memory-only stack (`closedItems`, last 20, `src/lib/closed-items.ts`) records closed header tabs, dock panes (attachment documents excluded) and browser tabs with an http(s) page. `reopen-closed` (⇧⌘T) reopens the most recent item still alive near its old position: a header tab, a dock pane (side chats through `openSideChat`, terminals ensuring a terminal), or a browser tab (opening the session's browser first if needed). The tab menu and Undo toast still reopen header tabs only. `meta+shift+t` is the one allowed combination with the reserved T key, in `src/lib/keybindings.ts` and the native mirror in `models.rs`.
- **PR bodies:** the Summary renders the body with `ChatMarkdown`. `prBodyMarkdown` drops HTML comments (templates), turns `<img>` with an https source into Markdown images (the CSP already allows `https:` images), turns `<br>` into line breaks and unwraps layout tags; any other HTML stays text, which React escapes. Images open in the app gallery scoped to the description (`data-gallery-scope`); links go through `openLink`.

## Consequences

- A focused control no longer loses keys to the composer; typing after clicking a button now needs a click in the conversation or composer first.
- Glass terminals compose slightly more slowly than opaque ones; opaque windows no longer pay for transparency.
- ⌘F over a diff no longer opens the conversation find bar; moving focus or the pointer away restores it.
- The reopen stack is memory-only and does not survive a restart, like the tabs themselves.
- Images in PR bodies load from GitHub over https when the Summary opens.
- Tests: `tests/type-to-focus.test.ts`, `tests/diff-find.test.ts`, `tests/closed-items.test.ts`, `tests/pr-body.test.ts`, additions to `tests/appearance.test.ts` and `tests/shortcuts.test.ts`, and `scripts/verify-pr-body.mjs` (SSR).
