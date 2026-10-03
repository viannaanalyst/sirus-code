# ADR-016: Native-owned transcript forks and message bookmarks

**Status:** Accepted (fork entry point superseded by ADR-028)

## Context

An assistant response can be a useful handoff boundary. A branch must receive real context without sharing a vendor thread, account default or destructive worktree ownership. Bookmarks must survive restart without pretending to affect model memory.

## Decision

`fork_session(sessionId, messageId)` accepts only existing native identities. Rust refuses active status/process handles and streaming transcripts, requires a nonempty settled assistant boundary, and copies user/assistant messages through that boundary with fresh IDs. Diagnostics, pending callbacks, pins and vendor thread identity are excluded. Provider/model/execution preferences and account bindings remain attached to the source profile. `forkOrigin` persists the source identity/title and inherited message count.

Git forks always allocate their own worktree/branch from the source workspace's current HEAD using existing guarded Git argv. Uncommitted files and historical filesystem state are not copied. Without Git, a non-isolated source checkout is shared; a broken isolated Git workspace is refused. No process starts until the owner sends a new instruction. Git creation and JSON persistence are not a cross-resource transaction; a persistence failure must be reported and must never trigger destructive automatic cleanup.

Before creating a workspace, reconstruction validates the entire imported transcript against 32 KiB of JSON context and 512 messages. Oversized histories fail explicitly rather than silently losing their boundary. The first fork turn reconstructs that context; native Codex/Claude/OpenCode start fresh and subsequent turns use their exact saved identity. Ordinary exact resume failures never fall back to reconstruction. Cursor/Grok keep their bounded fallback follow-up policy. Changing a fork's model/provider can require fresh reconstruction, which still enforces the budget. This is a transcript fork, not a clone of provider-private tool state or a filesystem checkpoint.

`set_message_pinned(sessionId, messageId, pinned)` validates a settled assistant owner and changes only `pinnedMessageIds`, idempotently, on a native worker. Failed persistence rolls that metadata back. Pins are local navigation bookmarks, not extra model instructions. Frontend acknowledgments are serialized per Session and update only pin metadata; earlier lifecycle snapshots cannot undo an acknowledged pin or replace newer output. The Environment card exposes jump/unpin actions over real bookmarks ([ADR-030](ADR-030-environment-context-references.md)); the fork origin link returns to its source boundary.

A native identity can arrive before input is accepted. Fork origin therefore records the native thread whose bootstrap completed successfully. Failed/interrupted initial turns retain reconstruction on retry; model/provider changes clear that marker. A failed later exact resume after successful bootstrap still remains an error, not a fallback to another conversation. A retry after partial acceptance can repeat quoted history; this is preferred to silently omitting the handoff context.

## Consequences

- **Positive:** reviewable conversation branches, persistent bookmarks and a fixed metadata IPC surface without renderer-supplied transcripts, paths, protocol payloads or process execution.
- **Negative:** long transcripts require a smaller conversation or an owner-written handoff summary. A Git fork sees current committed files, which may differ from the selected response's workspace.
- **Accepted trade-off:** explicit reconstruction plus exact future continuation, instead of claiming unverified provider-native fork support.

## Alternatives considered

Sharing a vendor thread/worktree, latest-thread resume, generic renderer history import, automatic summaries/inference and undocumented CLI fork flags were rejected. Vendor-native fork APIs can be added separately after binding and workspace semantics are verified.
