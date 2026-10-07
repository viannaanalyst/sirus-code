# ADR-069: Astros

**Status:** Accepted

## Context

MonoCode added Monos: long-lived agents on the project rail, each with its own conversation, mascot, soul, memory and habits. The owner liked the idea and the cosmic icon previews (`previews/monos/`) and chose the name **Astros**, which covers stars, planets, moons and galaxies alike.

## Decision

The first stage brings identity and a persistent conversation:

- **Astro.** A name, one of sixteen animated cosmic icons in a Metal or Neon style, a colour, a chat background, a Markdown soul and assigned projects. Astros are stored in `AppData.astros` (at most 12) and managed through one closed `astro_action` (list, save, open, delete, reset).
- **Conversation.** A normal session marked `Session.astro`, created the first time the Astro is opened, in the first assigned project's checkout (no new worktree). It is hidden from session lists and opened from the Astro's rail button. Reset deletes it and opens a fresh one; the soul and projects stay. Deleting an Astro deletes its conversation and never touches project files.
- **Context.** Like side chats (ADR-049), `send_prompt` wraps each turn natively: who the Astro is, its project folders and its soul, marked as app-added context ahead of the user's message. The persisted message keeps what the user typed.
- **Pixel style (removed).** A Pixel style with hand-drawn mascot sprites was tried and removed on 2026-10-06: two rounds of sprites and a six-direction preview did not satisfy the owner. Astros saved with it load as Metal (`astros::retire_styles`), and native validation no longer accepts it.
- **Look.** `src/lib/astro-art.ts` draws the icons and backgrounds on canvas; one shared animation loop paints every mounted icon and runs only while the ambient gate is open. Reduced motion shows still frames.

**Memory.** `Astro.memory` holds up to 200 dated facts (400 characters each), newest first. The facts that fit a 6,000-character budget travel in every turn's context, so they survive new conversations and provider switches. The user adds, edits and forgets facts in the Astro panel. The Astro manages them itself through `astro_memory_list/add/replace/forget` on the existing per-session MCP bridge (ADR-030), which answers only in sessions marked with an Astro. `astro_soul_read/update` lets it rewrite its soul when the user asks.

**Habits.** A habit is an automation with `astroId` (ADR-051's scheduler, run history and failure pause). It is created from the Astro panel, limited to the Astro's projects and defaults to the project checkout. Each run is a hidden session marked with the Astro, so it carries the soul and memory; its prompt asks for a short report, or exactly `NOTHING_TO_REPORT`. When the run settles, `astros::settled` posts the final answer to the Astro's conversation (unless it is quiet, failed or the conversation is busy), marks the run `reported` and raises the Astro's `unread` count, shown as a dot on its rail button. Habits are removed with their Astro. Since the Automations page was removed (2026-10-07, ADR-051), every automation is a habit.

**Delegation.** An Astro can drive sessions in its own projects through `astro_sessions_list`, `astro_session_start` (a new, normal and visible session, in an isolated worktree by default), `astro_session_read` and `astro_session_send`. Delegated sessions inherit the permission mode of the Astro's conversation, so with Ask they wait for the user in their own tabs. A session started or messaged with `notify` carries `Session.delegation` (Astro, batch, settled). The batch is the Astro turn that started it, so the sessions launched together report together. When every session of a batch has settled and the conversation is idle, `astros::settled` sends one short visible message ("🛰 N sessions finished") to the conversation; the results ride in that turn's context (`Astro.pending_report`), and the Astro writes a single consolidated report. A failed delivery returns the batch to the queue for the next settlement.

**Cards.** An Astro's replies can carry fenced `sirus-card` JSON blocks, rendered by `AstroCards` in its conversation only: a live session (status, opens it), a pull request (opens it on the Pull requests page), reply choices (one click sends the option) and a habit suggestion (created only when the user clicks Create habit; schedules are normalized to the closed kinds). In the habits panel, each run marker opens that run's session.

**Details drawer.** Creating and editing both happen in one right-side drawer (the Arc drawer, with the system's slide-in and quicker exit), after MonoCode's Mono drawer. `+` on the rail creates an Astro with a starting look in the current project, opens its conversation and its drawer. On an existing Astro, the drawer opens from the conversation header (its icon and name, with a caret shown on hover) or a right-click on its rail icon; there is no separate details button. The drawer saves every change as it is made: name, style, the sixteen icons, preset or custom colour, the conversation's model (and effort when the model offers levels), projects, then Soul, Habits and Memory pages that slide in place, and New conversation and Delete at the bottom. Chat backgrounds were removed; conversations use the plain chat surface.

## Consequences

- **Positive:** a persistent assistant with a recognisable identity, built from existing sessions, providers and approvals.
- **Negative:** habit runs are hidden from session lists and reached through their run markers. The conversation runs in one project's folder; work in other assigned projects relies on the provider reaching their paths, which some sandboxes restrict.

## Alternatives considered

- **Storing Astros in the webview's local storage, as MonoCode does.** Rejected: the rest of the app's state is native JSON, and the conversation context is built natively.
- **The name "Monos".** It is MonoCode's own name.
