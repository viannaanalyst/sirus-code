# New sidebar preview

Run `node previews/sidebar-synara/server.mjs`; open **http://localhost:4194/**.

The proposal follows the local Synara `AppRail.tsx`, `SidebarActivityView.tsx` and `SidebarThreadRowContent.tsx`: fixed icon rail; workspace title/search/drafts controls; New session; activity scope and order controls; Drafts and Recent; two-line session rows with project/worktree/PR/branch metadata.

Sirus Code fonts and assets stay local. Everything, including PR numbers, running state and activity text, is explicitly example data. Native calls, user files and providers are never accessed. Search, project/draft scopes, sort, selection, unsent text, new example session, Back and sidebar collapse work in memory. The rail also demonstrates separate Projects, Kanban, Archived and Settings panels using example data.

Dark/Light/System and optional sidebar glass are independently selectable. The chat remains opaque. The previously approved animated orbital activity icon appears in the conversation header only; model icons remain in the sidebar. Reduced motion disables animation.

The approved sidebar is implemented in the product. Collapse to retain the rail; hover/focus opens a temporary section panel, leaving closes after 180ms, and the top panel button docks the visible section. Tab/Arrow Right and Escape provide keyboard access. This preview is memory-only; the product reuses its persisted sidebarCollapsed preference. No new persistence mechanism or IPC was added.
