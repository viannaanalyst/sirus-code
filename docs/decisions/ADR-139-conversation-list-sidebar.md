# ADR-139: A conversation list as a third sidebar style

- Status: accepted
- Date: 2026-10-18

Extends ADR-092 and ADR-121.

## Context

The icon rail (ADR-092) leaves conversations to the header switcher and tabs. The owner approved a preview of a third style: a column listing recent conversations from every project, with project, age, title, branch and model.

## Decision

- `AppSettings.sidebarMode` (`rail` | `list`, default `rail`) chooses the style; the existing `sidebarCollapsed` still means hidden. Settings → Appearance → Sidebar offers Icon rail, Conversation list and Hidden; Hidden keeps the style, so ⌘B toggles the chosen style and hidden. Old settings load unchanged as the rail.
- `sidebarListOrder` (`recent` | `project`, default `recent`): Recent is flat by last activity ("Working and unread first" applies); By project groups under one header per project, ordered by its latest unpinned conversation. Pinned conversations come first. Both are closed native enums.
- The list shows listed conversations only: no archived, snoozed, side chat or Ask conversation, and no team worker whose coordinator is listed. The order holds while the pointer is over it (ADR-121).
- The column is 280 px, resizable within 264–420 px (memory only). Its header has the window controls space, Sirus Code, back/forward, the order menu and collapse; then search (command palette), Open project, New project, New conversation; Inbox / Tasks / PRs with their dots; the rows; usage rings, Archived and Settings at the foot. Rows show project icon, name and age with the status dot, the title (stronger when unread), branch and model mark; one list-level context menu offers split, rename, pin, snooze, archive, move and delete. The header project switcher is hidden while it shows (⌘⇧P opens the palette instead); tabs stay.
- Performance: windowed past 60 items with two measured heights, rows memoized on session metadata, no polling (ages refresh on focus, visibility or pointer entry), rows unmounted while hidden.

## Consequences

- The list's width is not persisted.
- The PR dot is computed in the list's own nav hook as well as in the rail; they should share one helper.

## Amendment: round 2 (2026-10-18)

The owner approved a second preview: a simpler list header, folder-only By project, a fourth style that shows one project at a time, and Settings cards with real miniatures.

- **List header.** The top row holds the window controls space, Sirus Code, small back/forward arrows (the titlebar arrows are not drawn while a column shows, so they stay here) and collapse. The second row is Search (palette), Order (the order menu, moved down), New project and New conversation. The separate Open project button is gone: New project opens the dialog that already offers opening a folder, creating one and cloning. Inbox · Tasks · PRs follow, unchanged. The order menu also toggles "Working and unread first".
- **By project is folders only.** One collapsible row per project (chevron, project icon, name, the dot of its most urgent conversation — working, then waiting, then unread — and its count). An open folder is followed by its conversations, indented, without the project line: dot, title and age, then branch and model mark. Folder rows are buttons with `aria-expanded`. Which folders are open is `AppSettings.sidebarOpenFolders`: `null` until the person opens or closes one (then the selected project's folder shows open), otherwise at most 100 owned project ids, validated and pruned natively. Selecting a conversation anywhere opens its folder.
- **Project style.** `sidebarMode` gains `project` (closed enum; older settings still load as the rail). The column has the window controls space, collapse and back/forward on top; the project switcher (the header's popover, mounted here instead, opening on click or ⌘⇧P but not on hover) with New conversation; the same Search · Order · New project and Inbox · Tasks · PRs rows; the selected project's conversations under Pinned, Today, This week and Older (compact rows: dot, title, age; branch and model in the tooltip); a sideways-scrolling strip of every project's icon in the switcher's order, with arrows, the current one highlighted and a click switching project; and below it the usage rings, Archived and Settings, kept as their own small row so they stay reachable. The header switcher hides while this column shows, like with the list.
- **Settings → Appearance → Sidebar** shows three radio cards (Icon rail, Conversation list, Project), each with a still miniature of the window in that style: lightweight replicas that reuse the sidebar's own classes, fed with the person's first projects and conversations from the store, drawn at 1000 × 600 and scaled to the card. They exist only while the page is open, never animate and make no native calls (project icons skip the favicon lookup).
- **Round 3 (folders and choices).** Folder rows drop the count and put the chevron at the end (New conversation appears just before it on hover). An open folder's conversations are one line each under a thin guide from the folder: dot, title, the branch only when the conversation has its own worktree, and age; the model is in the tooltip. A folder shows its first 5 conversations (plus the selected one) and Show more / Show less, remembered for the window only. Opening grows the rows in with a short stagger; closing folds them up before they leave the list (none with reduced motion). The Hidden card is gone: ⌘B hides any style, and picking a card shows the sidebar again.
- Performance is unchanged: one windowed list for all three orders (conversation rows and headers each have one measured height), memoized rows, no polling; time groups read the clock only when ages refresh, and a held order also holds each row's group.
