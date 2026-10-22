# ADR-158: Approvals explain full access, and a message redirects

**Status:** Accepted (2026-10-21).

## Context

On full access Claude still asks before some actions: an ask rule in the person's Claude settings, a hook, or a check Claude enforces regardless (sensitive files, risky commands). The card showed Claude's reason text but not why full access did not cover it. And a message typed while an approval waited went to the queue or steered a reply that could not read it until the approval was answered.

## Decision

- **Who asked.** `claude.rs` reads `decision_reason_type` from `can_use_tool` and sends `askedBy` (`rule`, `hook`, or `check` for anything else) with tool requests; the reason text loses terminal escape sequences. On a conversation with full access, the approval card says which one asked.
- **A message redirects.** Sending from the composer while approvals (not questions) are pending declines them first, then steers the reply with the message (or queues it for providers that cannot steer). If a decline fails, nothing is sent. The placeholder says so while an approval waits.

## Consequences

- Full access reads as predictable: an approval names its cause.
- Typing "no, do X instead" works without first pressing Decline.
