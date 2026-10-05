# ADR-057: Context usage and compaction

**Status:** Accepted

## Context

Long conversations fill the model's context window, and answers degrade without warning. The owner asked for MonoCode's context indicator and `/compact`.

## Decision

**Reading.** `Session.contextUsage { used, window }` stores the latest reading the provider reports. Nothing is inferred.

| Provider | `used` | `window` |
| --- | --- | --- |
| Codex | `thread/tokenUsage/updated` → `tokenUsage.last.totalTokens` (the running total grows across compactions and is ignored) | `modelContextWindow` |
| Claude Code | Main-agent `assistant` events → `input + cache_creation + cache_read + output` tokens | Successful `result`: the largest `modelUsage[*].contextWindow` |

- **Missing window:** a reading without one keeps the last window known.
- **Model change:** changing the model clears the reading.
- **Other providers:** they report nothing and show no indicator.

**Indicator.** The composer shows a ring once both numbers are known; it turns amber at 75% and red at 90%. Its popover shows the percentage, used/window tokens and Compact now.

**Compaction.**

- **Trigger:** Compact now, or typing `/compact`, sends the standalone `/compact`.
- **Codex:** with an existing thread, `/compact` calls `thread/compact/start` and follows the compaction turn from `turn/started` to `turn/completed`.
- **Claude Code:** receives `/compact` as its own command. The usage on the result of that turn is ignored, because it describes the summarizer call.
- **In the transcript:** an empty reply to `/compact` reads "Context compacted".

## Consequences

- **Positive:** the person sees when a conversation is getting heavy and can compact it without starting over.
- **Negative:** readings exist only for Codex and Claude, and only after a turn.
- **Security:** no new IPC or capability. `/compact` is an ordinary explicit Send. Codex compaction uses one fixed protocol method, bound to the session's own thread.

## Alternatives considered

- **Estimating tokens locally.** Rejected: the UI must show real provider data.
