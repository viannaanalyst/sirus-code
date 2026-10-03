# ADR-014: Scoped authenticated quota reads and account identity

**Status:** Accepted

Account-management prohibition partially superseded by [ADR-015](ADR-015-isolated-provider-accounts.md) for explicit new-profile Codex/Claude vendor login. Cursor/Go credential reads remain scoped and read-only.

## Context

The owner explicitly authorized Cursor/OpenCode quota integration using their existing credentials, and requested the account behind each snapshot. The installed CLIs expose no account-quota command. OpenCode Go has a server-owned usage endpoint; Cursor's dashboard APIs return personal quota pools. CLI-only probes cannot implement these integrations. This supersedes ADR-013's blanket prohibition on host credential readers and expands its normalized response metadata; the reset lifecycle, visibility and no-polling rules remain.

## Decision

- `provider_usage_http.rs` reads only the Cursor CLI access token and the `opencode-go` API key. macOS Cursor uses the exact `cursor-access-token` / `cursor-user` Keychain item. Other platforms use the CLI's known auth file. Go uses explicit injected auth or its known data-directory auth file, selecting only its namespace. No browser cookies, app databases, general config/key discovery, refresh tokens, login or account switching. Files are bounded, regular, owner-validated and opened read-only without following the final symlink on Unix.
- Rust constructs authenticated GET requests to three fixed HTTPS endpoints: Cursor `usage-summary` and `auth/me`, and OpenCode Go `zen/go/v1/usage`. The native reqwest TLS client has deadlines, bounded responses, no redirects, retries, proxies or cookie jar. Headers are marked sensitive. Existing typed IPC takes only provider/refresh; the renderer cannot choose URLs, credentials, headers or paths. No new capabilities or frontend network authority.
- Cache identity includes executable override and a native-only credential digest. The credential is checked before cache lookup and after a fresh request; a changed identity discards the result. Account/profile and quota requests use the same credential. Account metadata, quota snapshots, credential digests and reset offers remain memory-only. Credentials and raw responses are never logged, serialized to IPC or saved.
- The normalized response allows bounded email/name/plan and a 12-hex SHA-256 key fingerprint. Codex uses `account/read` with `refreshToken: false`; Claude supplies account metadata during initialize; Cursor supplies authenticated profile metadata. Go's endpoint has no email: its connected key is identified by fingerprint, without exposing any part of the key. These are last-read identities, not account management.
- Existing earned Codex reset offers also bind the CLI-reported account email. A fresh initialize must match before the retained named credit can be consumed. Unknown/mismatched accounts disable redemption. ADR-013's explicit confirmation, expiry, once-only reservation, idempotency and no-purchase rules still apply.

## Consequences

Real Cursor and Go subscription limits are available without prompts or credential modifications. Go does not describe every OpenCode backend. Cursor's private dashboard schema and Claude's experimental control can change; failures remain explicit instead of switching credential sources or fabricating quota. A short fingerprint identifies a key, not the human account email. Local credential reads expand native authority narrowly; no generic reader or account mutation API is added.

## Alternatives considered

CLI `status/about/stats` cannot supply these subscription quotas. Copying browser-cookie/SQLite scanners, broad configuration readers or login/refresh flows would expose unrelated credentials and accounts. Raw response passthrough would expose vendor metadata outside the quota feature. Implementations and verified source links: [usage guide](../development/provider-usage.md).
