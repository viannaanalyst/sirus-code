# ADR-060: Composer app commands and conversation export

**Status:** Accepted

## Context

A leading `/` in the composer only offered skills. Synara and MonoCode also offer app commands such as `/review`, `/status` and `/export`. The owner asked for them, without conflicts with skills.

## Decision

**Commands.** `/review`, `/compact`, `/status`, `/fast`, `/rename`, `/fork`, `/export`, `/side` and `/new` join the `/` list as rows marked "App command" (`src/lib/composer-commands.ts`). They are offered only when the `/` token starts the message, and only where they apply. Most need a started conversation; `/fork` needs an idle one with a settled reply; `/compact` is offered for Codex and Claude; `/fast` appears only when the model offers Fast.

**No conflicts with skills.**

- **Execution:** a command runs only when it is chosen in the list. Its token leaves the draft and is never sent as text, except `/compact`, which the adapters already map (ADR-057).
- **Same name:** a skill named exactly like the typed query stays first, so an existing `/name` + Enter still picks the skill. Commands follow it, then the other skills.

**Behaviour.**

- `/review` sends a fixed review prompt for the uncommitted changes, in planning (read-only) where supported.
- `/status` shows a card above the composer with data the app already holds: provider, model, account, effort and Fast, approval, workspace and context.
- `/rename`, `/fork`, `/side` and `/new` reuse the existing actions.

**Export.** `/export` formats the loaded conversation as Markdown in the renderer: user and assistant text only, with localized labels. The new command `export_conversation(sessionId, markdown)` writes it. Security review:

- **Input:** the text is bounded to 8 MiB and must not contain NUL.
- **Ownership:** the session must exist.
- **Destination:** only the native save dialog chooses it, with a default name built from the session title and a `.md` extension. The renderer never sends a path.
- **Write:** a temporary sibling is written and then renamed, so a failed write never truncates an existing file.

## Consequences

- **Positive:** common actions are one `/` away and skills keep working as before.
- **Negative:** export writes renderer-formatted text. That is acceptable because only the person picks where it goes.

## Alternatives considered

- **Typed `/command arguments` executed on Send.** Rejected: ambiguous when a skill has the same name.
- **Native Markdown formatting.** Rejected: the renderer already holds the loaded transcript and the locale.
