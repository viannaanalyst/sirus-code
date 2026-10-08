# ADR-094: Working panel beside the composer

**Status:** Accepted

## Context

MonoCode shows its running agents in a small "Working" panel at the bottom of the sidebar: a count, then each session with its icons, title, what it is doing and how long. It appears only with two or more agents in flight. The owner asked for the same beside Sirus's composer, turned on or off in Chat behavior. The ⌘J switcher (ADR-093) was not what was wanted, so the shortcut is removed.

## Decision

- **Where:** floating at the bottom-left of the conversation, in the free space left of the centred composer. It never takes room from the composer or moves it. It shrinks to that space (280 px at most) and hides when less than 220 px is free, so narrow windows, splits and phones keep the composer as it was.
- **When:** only with two or more sessions in flight (starting, running or waiting) and the `showWorkingPanel` setting on (default on). Below two the panel is not rendered.
- **Rows:** each session shows its provider icon, its project's icon and name, its title, what it is doing now (the running step, "Waiting for you", or "Working"), and the elapsed time, which ticks once a second while sessions run. Waiting sessions come first, in amber, then the rest oldest first. Four rows show, with "+N more" for the rest. Clicking a row opens its session.
- **Setting:** Chat behavior → "Show working sessions" (`showWorkingPanel`, on Rust and TypeScript sides).
- **Removed:** the ⌘J shortcut and the quick switcher component.

## Consequences

- The panel reads only the store: no new IPC, and no polling beyond the one-second clock while sessions run.
- It also appears in the phone app's conversation only if the window is wide enough, which a phone is not.
