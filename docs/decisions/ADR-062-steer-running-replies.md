# ADR-062: Steer a running reply

**Status:** Accepted. Amends ADR-042.

## Context

A message sent while an agent works waits in the request queue (ADR-042). Synara can send it into the running reply instead ("steer"). The owner asked for this.

## Decision

**Providers.**

- **Codex:** `turn/steer` with `expectedTurnId`. The request waits for its response, and the turn's other events (including approval callbacks) wait in the existing deferred queue.
- **Claude:** the instruction is written to stdin during the turn. It now runs with `--replay-user-messages`, so an instruction echoed back is known to be read. A `result` that arrives while an instruction is still unread is not final: the CLI continues with it.
- **Other providers:** they refuse the instruction, and the message stays in the queue.

The protocols were checked live: Codex added the instruction to the same turn, and Claude read it at its next step in the same turn.

**IPC.** One new command, `steer_turn(sessionId, text)`. It accepts text only (1–65,536 bytes) for an active Codex or Claude session with a live process, through the turn's existing inbound channel (now `Inbound::Answer` or `Inbound::Steer`). The turn keeps its model, approvals and attachments. After the provider accepts, the text is recorded on the streaming reply as `Message.steers` (`{ text, at, offset }`, with `offset` the reply's UTF-16 length). The transcript shows it as a "Your instruction" bubble at that point in the reply.

**UI.**

- **Queue:** each queued text-only item has "Send now" while a steerable reply runs.
- **Setting:** General → "Steer the running reply" (`steerWhileRunning`, off by default) makes plain messages sent during a reply steer instead of queueing. Messages with attachments still queue.

## Consequences

- **Positive:** corrections reach the agent while it works, without stopping it.
- **Negative:** an instruction can arrive too late to change work already done. The provider decides when to read it.

## Alternatives considered

- **Storing the steer as its own user message.** Rejected: it would split the reply, its activity and its turn review.
- **Steering by default.** Rejected: the queue's explicit ordering stays the default.
