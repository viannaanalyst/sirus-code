# ADR-029: Sidebar organization as owner-validated settings

Date: 2026-10-01
Status: Accepted

## Context

The sidebar needs global session bookmarks, ordered project bookmarks and reversible archiving. These are navigation preferences, while Rust owns session execution and exact provider continuation. Project hover cards also expose a display-name editor.

## Decision

Persist `sidebarProjectOrder`, `pinnedProjectIds`, `pinnedSessionIds` and `archivedSessionIds` through the existing `AppSettings` and `save_settings` boundary. Each list accepts at most 4,096 nonempty IDs of at most 64 bytes. Native load/save and metadata removal discard unknown IDs and duplicates; archived sessions cannot also be pinned. Legacy settings default to empty lists.

Manual folder ordering survives last-opened updates. New folders follow the saved order; pinned folders remain first, with manual moves within the same pinned/unpinned group. Dragging the folder title and Option + Up/Down reuse the existing settings save queue and never change project paths or session ownership.

General also persists closed native enums: `sidebarProjectSortOrder` is `manual | created_at` and `sidebarThreadSortOrder` is `updated_at | created_at`. Legacy state uses manual projects and newest-created sessions. The project “Recent activity” mode was removed on 2026-10-02 so opening or using a project never moves its folder; retained `updated_at` values load as `manual`. Project creation order uses `addedAt`. Session order uses native `createdAt` or `lastActivityAt`. Comparisons descend, invalid dates use zero and ties preserve manual/inventory order. Project pins take precedence; global session pins retain their pin order. Dragging or keyboard-moving a project switches to manual mode and captures the current displayed order. Sorting never mutates native metadata or execution.

Pinned sessions appear once in a global section and return to their owning project when unpinned. Archived sessions are hidden from ordinary sidebar lists and automatic reopening, but remain available in an explicit Archived sessions view. Restoring does not recreate a previous pin. Archive metadata does not modify process status, exact native threads, drafts, messages or worktrees; an archived running session can continue.

The sidebar keeps a 52px navigation rail mounted when collapsed. Home groups real owned sessions under project folders, with unique global pins, compact model-icon/title rows, with live status indicators (draft indicators and the drafts filter were removed on 2026-10-06; see ADR-052). Search sits beside the selected project title and filters owned sessions. The floating header retains its explicit Pin control; the docked header omits a duplicate collapse control, the activity scope/sort menus, redundant Projects heading/add control and footer count/Open project. The existing titlebar and keyboard shortcut still collapse the rail. Compact outline rail icons share a single rounded content frame below the titlebar, extending through the sidebar and content to the window edges; usage has no separate divider. Project/worktree details remain in the existing hover cards and Environment panel; session rows omit folder, branch and PR metadata. The sidebar never starts PR probes. Home retains the original project inventory and reorder/actions; the duplicate Projects rail button and panel are omitted; Kanban and archives use existing destinations. Settings is a direct rail action that opens the original full SettingsPage, retaining its grouped navigation and content. It is not a sidebar section or hover preview.

Collapsed Home/Kanban/Archives rail icons open a temporary nonmodal Radix panel on hover or focus, with Arrow Right entering its controls and Escape returning to the rail. Pointer departure across the rail/panel schedules a revision-bound 180ms close; nested menus, dialogs, keyboard focus and project dragging retain their owner. Hover never changes the main selection or saves preferences. The panel's explicit header control docks the visible section through the existing persisted `sidebarCollapsed` setting. Local section/search/filter state is not another application store, and the native browser parks whenever a visible floating overlay intersects its viewport, including a narrow edge missed by point sampling.

The single new command, `rename_project`, resolves an existing project ID and accepts a trimmed printable display name of 1–200 characters. It writes metadata atomically on a native worker under the existing state lock. It never renames directories or accepts a filesystem path. The UI calls it only through the Client/Transport boundary; capabilities and CSP are unchanged.

Project shortcuts reuse existing authority: New thread opens the clicked project’s landing; Review changes opens the existing Changes dock for a non-isolated checkout session, creating an idle session if necessary; Terminal creates an idle checkout session and opens the existing terminal pane. They do not send agent prompts or accept renderer command strings. This local Changes view does not claim Synara’s pull-request inbox integration.

## Consequences

- Sidebar organization survives restart without another persistence mechanism or new pin/archive IPC commands.
- Metadata removal cannot retain bookmarks to unrelated sessions.
- Archives remain visible through other session inventories such as Kanban; archiving is a sidebar preference, not a native lifecycle state.
- Rename/remove remain keyboard-accessible through existing dialogs and context menus. A sidebar-local hover-card context admits one card at a time and dismisses replaced cards immediately; delayed leave callbacks are bound to their own row. Expand/collapse keeps a grid shell mounted for height/opacity transitions, marks collapsed children inert and follows animation preferences. Hover cards retain pointer access across their gap and support focus entry with Arrow Right. Session menus/dialogs dismiss and suspend cards until closed; focus from portalled actions cannot reopen a background card.

## Alternatives considered

Session-level archive booleans would make a navigation preference part of the execution domain. Renderer-only local storage would diverge from the existing native settings persistence. Deleting sessions or stopping their processes when archiving would make this reversible navigation action destructive. None is needed.
