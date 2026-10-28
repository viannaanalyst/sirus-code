# ADR-110: Kanban retired; agents keep Tasks; `.icns` project icons; compact activity rows

**Status:** Accepted (2026-10-11). Superseded by ADR-172 (Tasks and scheduled tasks removed).

## Context

The owner chose these changes:

- retire the Kanban board, which overlapped the project switcher and the Inbox;
- let agents keep the Tasks list from a chat;
- use macOS `.icns` app icons as project icons;
- lighten subagent rows and tool-group summaries;
- check that the queue pauses after a stop.

## Decision

- **Kanban retired.**
  - The board, its rail item, its palette action and its main view are gone.
  - `kanban` left `RAIL_ITEMS`, so saved rail orders and hidden lists drop it.
  - Tasks, Inbox, Archived and Pull requests stay.
- **Agents keep the Tasks list**. Three Sirus tools, under the same "agents manage sessions" switch:
  - `sirus_create_task` files a to-do under the caller's project unless another project or `none` is named;
  - `sirus_list_tasks` hides done ones by default and shortens notes, at most 100 rows;
  - `sirus_update_task` edits fields or marks a to-do done or not done.

  Planning turns cannot use the create and update tools. Deleting a to-do and handing it to a session stay with the person. A `tasks-changed` event reloads the list in open views.
- **`.icns` project icons**. When automatic project icons are on, `.icns` files in known places (`src-tauri/icons/icon.icns`, `build/`, `resources/`, `Resources/AppIcon.icns`, …) give their embedded PNG: the smallest at least 96 px, else the largest, up to 4 MiB.
- **Compact subagent rows**. Subagent cards lose their box and use one line per agent. Only running and failed outcomes are coloured; finished ones read muted.
- **Tool-group summaries**. Kinds are named in the order the work happened, at most three, with the rest folded into "N other actions". A trailing "N failed" is the only coloured part.
- **Queue after a stop.** The queue already paused after a stop or a failure. Each now says which: "you stopped the agent" or "a failure".

## Consequences

- The rail has five customizable items.
- A chat can turn "note this for later" into a real to-do that shows in Tasks at once.
