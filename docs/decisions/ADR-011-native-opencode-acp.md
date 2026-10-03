# ADR-011: OpenCode interaction uses native ACP

**Status:** Accepted; fixed approval-profile restrictions superseded by [ADR-017](ADR-017-per-turn-approval-profiles.md).

## Context

The fallback OpenCode invocation cannot answer native permission requests or preserve exact sessions. Installed OpenCode 1.18.34 advertises ACP v1 and exact session loading.

## Decision

- One owned `opencode acp --cwd` process per turn uses shared bounded native wire, monitor and process-group cleanup. Initialize advertises no filesystem, terminal or authentication client capability. Native load uses only the saved owner/project/canonical workspace/model-bound identity. Load replay is discarded; saved transcript stays authoritative. No textual transcript is sent.
- Native model config options must offer the requested exact value. Unknown models fail. Prompt is a stdin text block, and native prompt result owns completion. Only assistant message text reaches the transcript; thoughts and tool output do not masquerade as assistant text.
- The existing typed response IPC remains the sole host authority. Callbacks bind opaque renderer identity to process generation, native session and active turn, consuming each once. Only bounded native proposed file diffs under canonical workspace are reviewable. Allow-once and reject-once must be native offered options. No always grant, edited input or generic wire payload is admitted. External-directory, network, secrets, unsupported tool/fs/terminal/auth callbacks are denied.
- Child-only inline configuration disables sharing, selects build and requests explicit edit approvals and shell/network/external-directory denials globally and for build; it does not modify vendor files or login. ACP is not a sandbox and managed vendor configuration/plugins are not an OS jail. User cancellation denies pending callbacks, sends native session/cancel and awaits prompt settlement with bounded owned-group fallback.

## Validation and limits

Deterministic protocol fixtures prove exact identity loading, replay suppression, fresh prompt-only context, once-only decisions, foreign-generation refusal and duplicate refusal. Installed OpenCode 1.18.34 disposable live fixtures passed native edit acceptance, exact cross-process follow-up memory, edit refusal and cancellation. Cancel settled the original prompt with `stopReason=cancelled`. An explicit offered `opencode/big-pickle` model also passed under the initial child ask policy against disposable scalar global/build allow configuration. The hardened explicit per-tool policy overrides disposable nested edit/bash allow rules in a read-only merged-configuration probe. A controlled no-tools comparison identified subsequent failure as upstream `APIError`: CLI run fails with the same error, while ACP startup/model selection succeeds and its promptResponse maps the assistant APIError to `-32603`. No successful hardened-policy inference claim is made. Deprecated `mode.build` is also overridden because this CLI merges modes into agents after inline configuration. Initialization or model presence alone does not prove inference access; vendor/model failures remain explicit.

## Consequences

Exact continuation and approvals retain native ownership without frontend privileges. Unsupported protocols and models fail explicitly. Native compatibility is intentionally narrower than the full ACP protocol.

## Amendment (2026-10-03): Auto delegation to pinned built-in helpers

In Auto, the parent may use OpenCode's `task` tool, but only to call the built-in `general` and `explore` helpers. The parent permission is `{"*":"deny","general":"allow","explore":"allow"}`.

**Pinned helper policy.** The child-only inline config sets both helpers' `agent` **and** deprecated `mode` permissions to the same Auto policy, with `task` denied:

- edits are allowed;
- shell, network and external directories are denied;
- they cannot delegate further.

**Why both layers are pinned.** With OpenCode 1.18.34, `opencode debug agent` on a disposable repository showed two ways a repository can widen a helper:

- `.opencode/agent/general.md` or a custom agent (for example `sneaky` with `"*": allow`) can grant itself `bash: allow`;
- a project `opencode.json` `mode.general` entry can widen `general`, because modes merge after inline config.

Pinning both layers restored `deny`. Repository-defined helpers keep their own grants, but the last-match `task` rules make them unreachable.

**Unchanged:** Ask and planning keep `task` denied, and Full keeps its explicit allow.

**Not verified live:** inference through ACP on the local free tier fails with the documented APIError, so live delegation was not exercised.

**Activity:** ACP reports a delegation as tool `kind: "think"`. It becomes a child activity row named by the short `rawInput.description`; the prompt is never read. ACP does not forward the child's own tools, so OpenCode child rows show identity, time and state without steps.

## Amendment (2026-10-03): definitive provider errors end the turn

OpenCode 1.18.34 treats every provider stream error as retryable, including an exhausted OpenCode Go plan ("Go usage limit exceeded"). It retries with backoff forever, and ACP sends no update about the retries, so a turn looked like it was working indefinitely.

The adapter now starts `opencode acp --print-logs --log-level ERROR` and reads stderr line by line, with a bound on each line. It keeps only main-agent (`small=false`) `message="stream error"` lines, and from those only a ≤300-character reason.

- **Definitive reasons** (usage limit, quota, insufficient, credit, balance, billing, payment, unauthorized, forbidden, API key, authentication, free tier): the adapter sends `session/cancel` and fails the turn with that reason.
- **Transient errors:** the adapter leaves OpenCode's own retry behavior unchanged.
- **Other log lines:** discarded, never shown or persisted.

