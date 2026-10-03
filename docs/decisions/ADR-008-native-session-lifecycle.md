# ADR-008: Rust owns Session execution and transcript state

**Status:** Accepted

## Context

Agent processes outlive individual React effects. Renderer callbacks are an unreliable authority for process completion, streaming persistence and cancellation. The webview is also an untrusted boundary; accepting arbitrary assistant output or completion declarations from it expands that authority unnecessarily.

## Decision

- `agent.rs` owns fallback process monitoring, cancellation, stdout/stderr drain and final Session status. `agent_output.rs` normalizes fallback provider JSON streams. Codex app-server turns and shared wire/monitor lifecycle live in `codex.rs`; Claude native stream-json interaction lives in `claude.rs`, with the same native transcript authority; see [ADR-009](ADR-009-native-codex-interaction.md) and [ADR-010](ADR-010-native-claude-interaction.md).
- Native memory accumulates transcript output. Persistence occurs at start, event-driven bounded stream checkpoints, completion and graceful application shutdown. Persisted active states recover as stopped on restart.
- `session-updated` carries native lifecycle snapshots; `agent-output` carries native message identity, first-message snapshot and UTF-16 offset with incremental visible text; stderr is a separate System diagnostic excluded from follow-up context; `agent-exit` triggers a Git refresh. `send_prompt` responses do not replace newer frontend stream state.
- Remove `append_agent_output` and `complete_agent` from renderer IPC. UI can request send/stop, not declare process facts.
- Cancellation signals use a watch channel instead of locking a Child while waiting. Unix agents own a process group so Stop can terminate descendant tools. PTYs keep independent lifecycle and generation IDs.

## Consequences

- **Positive:** reliable ownership across renderer unmount/rebind, smaller IPC authority and cancellation that can interrupt wait.
- **Negative:** fallback CLI adapters do not offer interactive permission input or vendor-native continuation. A sudden application crash can lose output after the last saved snapshot.
- **Accepted trade-off:** reuse the existing Transport/events and atomic JSON persistence, without a second store, polling loop or generic command API.

## Alternatives considered

- Keep renderer-owned append/complete callbacks: rejected because UI lifecycle should not determine native process state.
- Drive every CLI through a PTY: rejected because it mixes the user terminal with provider protocols and still requires provider-specific parsing.
- Add a database or remote service: unnecessary for local lifecycle ownership.
