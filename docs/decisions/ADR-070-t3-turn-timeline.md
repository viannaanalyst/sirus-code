# ADR-070: T3-style turn timeline

**Status:** Accepted (2026-10-06). Amends [ADR-035](ADR-035-native-turn-activity.md).

## Context

A turn's activity showed as one block of generic rows ("Read / search", "Command") with timeline dots, above all of the reply's text. Text the agent wrote before running tools appeared after them, and nothing said which file, command or skill a row was about. The owner asked for T3 Code's work log, which they use, and for skill invocations to show in it. An HTML preview of the design was approved before building.

## Decision

- **Rows say what they touched.** `ActivityItem.detail` keeps a short, bounded detail from the native event: a file path, the first line of a command, a search pattern or query, a tool or skill name (first non-empty line, at most 160 characters, no control characters). Command rows also keep the end of their output (`output`: ANSI codes stripped, last 60 lines and 3,000 characters), shown when the row is clicked (always folded at first, failed ones included: a failure shows as a red row); other rows never keep output, and file contents and reasoning are never retained. This reverses ADR-035's "no raw arguments" for this one short field; it stays local in the session file.
- **Rows know where they happened.** `ActivityItem.offset` is the reply's length (UTF-16 units) when the row first appeared, so the transcript interleaves text and work in the order they happened. Updates keep the first offset. Rows recorded before this have none and sit at the start.
- **Skills are rows.** A new `skill` kind: skills a prompt invokes (`skills::prepare` now returns their names) open the turn as settled rows, and Claude's `Skill` tool becomes one too.
- **The transcript (`AgentActivity`).** Text and work in order; back-to-back rows are one group whose sentence counts at most two kinds (skills, edits and commands first) and the rest ("Usou 1 skill, alterou 2 arquivos e realizou mais 2 ações"), opening into "Leu src/app.ts"-style rows. The header shows the turn's model as its own logo (the ring and orbiting satellite were removed on 2026-10-08; the state reads in the header text), then the readable model name ("Haiku 4.5"). While running, the header reads "Trabalhando há 12s" and the step running now is a live present-tense row with a text shine. When finished, the header becomes the fold "Trabalhou por 1m 3s ›" (no rule under it) (or "Você parou após…", "Falhou após…") and hides everything before the final answer, except failed steps. No dots, lines or checkmarks; workspace paths show relative. The fold follows the existing "fold finished turns" setting.
- **Subagents are cards** (2026-10-08, after T3 Code): each child is a bordered card, 6px apart, whose whole surface is the disclosure button (`aria-expanded`): a robot icon (a lightning bolt for background subagents), the title, a muted line with the role, model and, while running, the current step (once done, what it left: "Subagente · 2 edições de arquivo", or the failing step), then step count and elapsed time and a state pill: "Em execução" (accent, a dot that pulses and rests with the other status pulses when the window is unfocused), "Concluído" (success), "Falhou" (danger), "Interrompido" / "Interrompido no limite de tempo" (warning), "Não informado" (neutral). A click still opens the child's own steps inside the card, and a failed child opens itself. While the turn runs, new cards enter on the shared cascade (ADR-096), once per child while the app runs. This replaces the tinted planet row with "Pensando…" under it.
- **Composer and sent messages** paint `/skill` amber and `@file` blue (ADR-037).
- **Changed files card**, after T3 (`TurnChangeSummary`, `lib/diff-tree.ts`): shown only when the turn changed files; a quiet panel with a header "N arquivos alterados +a −d" (sticky until 2026-10-08, when rows showing through it over glass made it look misplaced), Open diff, expand/collapse all folders, and Keep/Undo; files as a folder tree (single-child folders merged, folders first, mono names, per-folder totals) whose folders start closed and keep their state per turn while the app runs.
- **Jump to latest output** is a raised round down-arrow over the transcript (after MonoCode), not a text pill.

## Consequences

- Session files grow by a short string and a number per row, plus at most 3,000 characters per command row (at most 128 rows per turn).
- A command line or its output can carry a secret; both are kept like the transcript itself, locally.
- The side chat keeps its own text rendering and shows only the work under the header.
