# ADR-069: Astros

**Status:** Accepted

## Context

MonoCode added Monos: long-lived agents on the project rail, each with its own conversation, mascot, soul, memory and habits. The owner liked the idea and the cosmic icon previews (`previews/monos/`) and chose the name **Astros**, which covers stars, planets, moons and galaxies alike.

## Decision

The first stage brings identity and a persistent conversation:

- **Astro.** A name, one of sixteen animated cosmic icons in a Metal, Pixel or Neon style, a colour, a chat background, a Markdown soul and assigned projects. Astros are stored in `AppData.astros` (at most 12) and managed through one closed `astro_action` (list, save, open, delete, reset).
- **Conversation.** A normal session marked `Session.astro`, created the first time the Astro is opened, in the first assigned project's checkout (no new worktree). It is hidden from session lists and opened from the Astro's rail button. Reset deletes it and opens a fresh one; the soul and projects stay. Deleting an Astro deletes its conversation and never touches project files.
- **Context.** Like side chats (ADR-049), `send_prompt` wraps each turn natively: who the Astro is, its project folders and its soul, marked as app-added context ahead of the user's message. The persisted message keeps what the user typed.
- **Look.** `src/lib/astro-art.ts` draws the icons and backgrounds on canvas; one shared animation loop paints every mounted icon and runs only while the ambient gate is open. Reduced motion shows still frames.

Memory (dated facts carried across conversations) and habits (scheduled background runs reporting in the Astro's chat) come in a later stage, reusing the Automations scheduler.

## Consequences

- **Positive:** a persistent assistant with a recognisable identity, built from existing sessions, providers and approvals.
- **Negative:** the conversation runs in one project's folder; work in other assigned projects relies on the provider reaching their paths, which some sandboxes restrict.

## Alternatives considered

- **Storing Astros in the webview's local storage, as MonoCode does.** Rejected: the rest of the app's state is native JSON, and the conversation context is built natively.
- **The name "Monos".** It is MonoCode's own name.
