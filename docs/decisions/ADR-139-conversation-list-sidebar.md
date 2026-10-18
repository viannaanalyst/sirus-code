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
