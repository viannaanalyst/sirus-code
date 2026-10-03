# ADR-003: Agents are host CLIs behind AgentProviderId

**Status:** Accepted; fixed approval-profile restrictions superseded by [ADR-017](ADR-017-per-turn-approval-profiles.md).

## Context

Users already authenticate Codex and Claude Code on the machine. Shipping our own tokens, or embedding vendor SDKs, would duplicate auth and expand secret surface. Coupling Session to “Codex” would force a rewrite for the next vendor.

## Decision

- Domain type `AgentProviderId`: `codex` | `claude` | `opencode` | `cursor` | `grok` (Rust + TypeScript).
- Detection: `which` on `codex` / `claude` / `opencode` / `cursor-agent` (then `agent` only if the path contains `cursor`) / `grok` (`detect.rs`). Uninstalled providers are shown as **Not Installed**, never faked as connected.
- Execution: `agent.rs` builds **argv arrays** and streams stdout/stderr as `agent-output`; exit as `agent-exit`.
- Session stores `agent: AgentProviderId` and an optional model ID. Codex and Claude additionally persist exact native identity bound to session/project/workspace/model; see [ADR-009](ADR-009-native-codex-interaction.md) and [ADR-010](ADR-010-native-claude-interaction.md). Other providers use bounded textual conversation context.
- Rust normalizes provider output and owns lifecycle/persistence; see [ADR-008](ADR-008-native-session-lifecycle.md).
- No `--dangerously-*` / `bypassPermissions` / `--yolo`. Codex uses app-server turns with workspace-write/on-request and typed host decisions. Claude uses bidirectional stream-json with manual permissions and typed original-input host approvals. OpenCode uses `run --format json`; its auto-approval flag is deliberately omitted. Cursor uses print + `--sandbox enabled --trust --auto-review`, with classifier-supported edits and no force/yolo. Grok uses `-p` with `--sandbox workspace`.

## Consequences

- **Positive:** uses existing CLI auth; new providers are an enum + detect + argv + Settings row.
- **Negative:** fallback print/exec adapters are not full interactive TUI agents; Codex and Claude interaction use scoped native protocol subsets; Claude question/MCP callbacks remain unsupported.
- **Accepted trade-off:** correctness and least privilege over “always can edit everything”.

## Alternatives considered

- **Vendor TypeScript SDKs in the webview:** secrets and network in the untrusted UI.
- **Always `--dangerously-bypass`:** rejected; too much privilege for a desktop host.
- **PTY-drive the interactive CLIs:** possible later; would mix agent I/O with the user terminal. Keep PTY separate ([ADR-007](ADR-007-pty-is-user-shell-only.md)).
