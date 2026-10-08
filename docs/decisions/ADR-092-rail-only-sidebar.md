# ADR-092: The sidebar is the icon rail; sessions live in the project switcher

**Status:** Accepted

## Context

Kanban, Archived, Tasks, Inbox and Pull requests had become pages (ADR-089), so the sidebar panel's only remaining job was listing each project's sessions. The owner wanted that space back, and wanted the sidebar toggle to show or hide the icons instead. Two placements for the session list were compared as previews:
- inside the header's project switcher;
- a separate "Sessions" page.

The owner chose the switcher.

## Decision

- **The sidebar is the icon rail only.** `Sidebar` renders the rail items, project shortcuts, Astros, the "more" menu, usage rings and Settings. There is no docked or floating panel, and no width to resize.
- **The toggle hides the rail.** `sidebarCollapsed` now means "rail hidden": the frame animates from 52 px to 0, and the content frame and header padding follow (`data-rail="hidden"`).
- **The header shows the project switcher and tabs in every conversation view**, not only with the sidebar collapsed.
- **The switcher has two columns:**
  - **Left:** projects with live status and uncommitted `+/−` counts. Right-click opens the project's actions: Edit project, through the extracted `ProjectEditDialog`, and Remove.
  - **Right:** every listed session of the project under the pointer or keyboard cursor, pinned first (`sidebarGroups`), with New session and, on hover, pin and archive.
  - The search matches project names and session titles.
- Home returns to the conversation, and every other rail item opens its page.

## Consequences

- Reordering project folders by dragging now has no surface. The saved order still applies to the switcher.
- Pinned sessions appear first within their own project, not in a global group.
- `SidebarProjects` and the panel rows are no longer mounted. `SidebarRows` still provides `ArchiveConfirm` and `ProjectEditDialog`.
