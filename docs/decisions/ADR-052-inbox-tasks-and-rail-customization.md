# ADR-052: Inbox, Tasks and a customizable rail

**Status:** Accepted

## Context

The rail grew to Home, Kanban, Archives, Pull requests (ADR-050), Automations (ADR-051), the drafts feather, quota rings and Settings. What needs the person's attention is spread across sidebar status dots, the Activity view, the review inbox and Automations.

Synara's Beta builds add three things:

- **Inbox:** a page derived from thread state. Its groups are Needs you, In progress, Ready for review and Failed, plus rows for PR review requests and automation problems.
- **Tasks:** a to-do list whose status comes from the chat a task is handed to.
- **Customize popover:** shows or hides rail items and reorders them, with Home locked, and pins projects as rail shortcuts.

The owner asked for all three.

## Decision

**Rail customization.**

- **Settings:** `AppSettings.railItemOrder`, `hiddenRailItems` and `railProjectShortcuts`.
- **Items:** a closed set: home, inbox, kanban, tasks, archived, pulls, automations. The drafts feather filter was removed later (2026-10-06): saved settings drop the `drafts` ID on load, and the sidebar no longer marks or groups sessions by unsent draft. Composer drafts still persist.
- **Native validation:**
  - order and hidden lists may hold only known IDs, without duplicates;
  - Home cannot be hidden;
  - at most 12 project shortcuts, each a bounded printable ID.
- **Behavior:**
  - A hidden item still shows while it is the current page.
  - Settings and the quota rings stay fixed at the bottom.
- **"···" menu:** toggles projects in the rail and opens Customize. Customize offers a checkbox per item and drag reordering of the whole row, plus Option+↑/↓ on the checkbox.
- **Dragging:** pointer capture through `usePointerReorder`, not HTML5 drag and drop. Tauri's native drop handling (`dragDropEnabled`) swallowed HTML5 drags in the macOS webview, so the window turns it off; nothing in the app consumed native file-drop events.
- **Project shortcuts:** show the project's initial and select that project.

**Inbox.**

- **A page derived from existing state; nothing new is stored:**
  - **Needs you:** sessions waiting for approval or input, plus one row for open PRs that request the viewer's review (from the review inbox list) and one for automations whose last run failed.
  - **In progress:** running sessions.
  - **Ready for review:** completed sessions the person has not opened (the existing `unseenSessionIds`).
  - **Failed:** failed or stopped sessions not yet opened.
- **What it leaves out:** side chats and archived sessions.
- **Actions:** "Mark all as read" clears the unseen list.
- **Badge:** the rail item shows a dot while a session is waiting for the person.
- **Deferred:** Synara's "your day" recap with token statistics.

**Tasks.**

- **Storage:** `AppData.tasks`, at most 500.
- **Fields:** a title (≤500 characters), notes (≤10,000), a priority (none/low/medium/high/urgent), an optional saved project, an optional due date (`YYYY-MM-DD`), a linked session and a completion time.
- **Status, derived from the linked session:** waiting is Needs you, running is Running, completed is To review, failed or stopped is Stopped. Without a session it is To do, and completion is Done.
- **Order:** priority, then due date, then age.

One closed command, `task_action`, has these actions:

| Action | Effect |
| --- | --- |
| `list` | Returns every task. |
| `upsert` | Creates or edits a task. |
| `delete` | Removes a task. |
| `setDone` | Marks a task done or not done. |
| `unlink` | Removes the linked session. |
| `delegate` | Hands the task to an agent (below). |

**Delegate.** It is an explicit person action, and it reuses the automations launcher (`automations::launch`):

1. It creates a normal session on the task's project, in an isolated worktree by default.
2. It admits the title and notes through `send_prompt`, with the chosen typed approval profile and optional planning.
3. It links the session to the task.

**Security review.**

- **Inputs:** renderer input is bounded text, closed enums, a provider ID and a model ID with the same charset rules as automations. Projects and sessions must exist.
- **Refusals:**
  - delegating while the linked session is active;
  - Full combined with planning;
  - a disabled provider.
- **Process spawn and admission:** stay in `send_prompt`.
- **No new surface:** no new event or capability.
- **Cleanup:** removing a project clears the project from its tasks, and deleting a session unlinks it.

## Consequences

- **Positive:**
  - One place shows what needs attention.
  - Tasks turn into agent work with one click and track it.
  - The rail adapts to what the person uses.
- **Negative:**
  - Inbox "Ready for review" depends on the in-memory unseen list, which resets on restart.
  - Task status can lag a session that was deleted until the next prune.
- **Accepted trade-off:** Tasks do not sync with GitHub Issues, Linear or Jira.

## Alternatives considered

- **Inbox as stored notifications with per-item done.** Rejected: deriving from live state never goes stale.
- **Replacing Kanban with Tasks (Synara Beta).** Rejected: Kanban stays, and Tasks is its own page.
- **Spaces, Void and Hubs.** Deferred. Grouping projects matters only with many projects, and Hubs overlaps with Team (ADR-043).
