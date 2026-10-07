# ADR-077: Private secret requests and credential masking

- Status: accepted
- Date: 2026-10-07
- Inspired by: T3 Code PR #15907 (secret requests with one-use refs) and Synara b8142ebce (redacted approval parameters)

## Context

Agents sometimes need a credential (an API key for a test, a token for a CLI). Until now the only channel was the chat: the person pasted the value into a prompt, where it was persisted in `sessions/<id>.json`, sent to the model and shown in the transcript. Separately, approval cards and activity rows showed commands verbatim, so `curl -H "Authorization: Bearer …"` or `GITHUB_TOKEN=… npm publish` were stored and displayed in full.

## Decision

**Secret requests.** The per-session MCP bridge (ADR-030) gains two tools, handled by `src-tauri/src/secrets.rs`:

- `request_secret { label, description?, envName?, path? }` blocks (up to 5 minutes) while the app shows a private card above the composer with the label, description, destination file and variable name, and a password field. Provide sends the value over `secret_action` straight to native memory; Decline (or timeout, Stop, turn end, quit) returns an error telling the agent not to ask in chat. On Provide the agent receives only a one-use `secretRef` and instructions; the value is never returned to the model.
- `use_secret { secretRef, target }` spends the reference once. `file` writes it to the workspace-relative `path` the person saw on the card (as a dotenv `NAME=value` line when `envName` was given, otherwise the whole file), refusing paths outside the workspace, in `.git`, through links or tracked by Git; new files are `0600` and the result says whether Git ignores the file. `env` writes `export NAME='…'` to a `0600` file in the app's private `secrets/` folder and returns a `( . file && command )` recipe, so the command still runs through the provider's own shell, sandbox and approvals.

The value lives only in process memory (overwritten on drop), is never persisted, logged, emitted or returned over IPC, and the store only sees the card metadata (`secret-state` event). References, values, pending cards and env files for a session are dropped when its turn settles (`finalize_session`), and everything is dropped on quit; the `secrets/` folder is wiped at start. While a value is live, any exact echo of it in agent output or activity is replaced by a mask. The transcript records only an app-owned activity row, "Secret provided (label)" with a lock icon. Codex gets `tool_timeout_sec = 330` on the bridge so the card can wait.

We did not add a tool that runs a command with the secret in its environment: the bridge's tools are pre-approved, so that would bypass the provider's sandbox and approval flow.

**Masking.** `src-tauri/src/redact.rs` and its mirror `src/lib/redact.ts` mask known token shapes keeping prefix and last four characters (`sk-••••abcd`, `ghp_`, `github_pat_`, `xox[abposr]-`, `AKIA`/`ASIA`, `glpat-`, `npm_`, Stripe keys, `AIza`), `Authorization`/`Bearer` values, URL passwords, credential-named flags (`--password x`, `--token=x`), credential-named assignments and JSON keys (`TOKEN=…`, `"apiKey": "…"`) and long high-entropy values in upper-case env assignments. Names are classified by their last word, so `max_tokens` and `primary_key` stay. Values under 16 characters become `••••`; references such as `$TOKEN` or `${{ secrets.X }}` stay. Activity `detail` and command `output` are masked natively before they are stored; approval cards mask command lines, reasons, diffs and tool input (credential-named keys hidden), and activity rows recorded before this change are masked at display.

## Consequences

- An agent can no longer get a credential into the transcript by asking for it properly; it still could by asking in chat, which the tool description discourages.
- The masker is heuristic: it hides common shapes, not every secret, and may hide a harmless value with a credential-like name.
- A process the agent runs can read the written file or env file; the protection is against accidental exposure (transcript, state, logs, model context), not a hostile agent.
- Secrets do not survive a turn: a follow-up turn must ask again.
