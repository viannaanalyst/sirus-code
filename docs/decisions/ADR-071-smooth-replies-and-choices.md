# ADR-071: Smooth streamed replies, reply choices and sent attachments

**Status:** Accepted (2026-10-06). Builds on [ADR-070](ADR-070-t3-turn-timeline.md).

## Context

Providers send reply text in bursts: a few characters, then a whole sentence at once. The owner disliked how replies "jumped" while streaming and chose, from a preview, a steady reveal. Agents also often ask the person to choose in prose ("Como aplicar? - Escolha em cada envio - Padrão permanente") instead of the provider's question tool, so no question box opens. Codex offers its `request_user_input` tool only in plan mode, and Claude's `AskUserQuestion` is not available to the headless runs, so asking the agents to use those tools would not cover the common case.

## Decision

- **Smooth reveal (`useSmoothText`).** A streaming agent reply shows at about 70 characters a second, speeding up with how far behind it is (`smoothAdvance`), at most ~30 updates a second. Text already present when the reply mounts shows at once, so switching sessions never replays it; a settled reply, a rewritten prefix or reduced motion shows everything. Timeline rows whose offset lies past the revealed text wait for it.
- **Reply choices (`replyChoices`, `ReplyChoices`).** When the last answer of a settled turn ends with a question beside 2–6 short list items (each at most 160 characters), the transcript shows the items as numbered buttons plus "Other…". An option is sent as the reply through the composer (same model, effort and approval); if the composer already has a draft, the option is put above it and the composer is focused instead. "Other…" focuses the composer. Lists without a question, lists not at the end and long items are left alone.

- **Sent attachments (2026-10-06).** A user message keeps `attachments`: name, kind, MIME type and, for images, a JPEG thumbnail (360 px on the longer side, at most 96 KiB) made when the attachment is prepared, never on the send path. The bubble shows image thumbnails on top (after MonoCode), then the request as written, then other files as chips; the reference block the agent receives is never shown (`splitPromptContext`), and older messages get their chips from that block.
- **Remembered approval.** With no choice in the draft, the composer keeps the approval mode last used: the session's own (`session.execution.approval`), or for a new thread the project's most recent session with that provider. Settings still never store a global approval grant.

## Consequences

- Detection is a heuristic over the final text: a list that merely ends with a question can show buttons that are not needed; they disappear as soon as anything else is sent.
- Session files grow by each sent image's thumbnail (at most 96 KiB, at most 8 per message).
- The provider's own question tool, when used, still opens the native question box (ADR-035/ADR-042 request flow).
