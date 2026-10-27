# ADR-166: Model catalog probes let Claude exit before their group is killed

**Status:** Accepted (2026-10-27).

## Context

After ADR-165 the default Claude login was still blanked the morning after the Mac had been off.
The first message of the day in a conversation on the default profile failed with `OAuth session
expired and could not be refreshed`. A conversation on a named profile worked. The default
profile's Keychain item was rewritten empty at 09:21:48, nine seconds before that message reached
the CLI.

ADR-165 covered the usage probe and kept agent processes. It missed the model catalog.
`provider_models::list_claude` asks `claude -p --safe-mode` for its `initialize` answer through
`cli_output::request`. That helper sent `SIGKILL` to the process group the moment the answer
arrived. The catalog is read at launch (`loadAllModels`), and again before a turn
(`commands::ensure_model_catalog`) whenever the cached one does not list the session's model as
available. It always runs on the default login, because it gets no profile environment.

The access token expires overnight, so the catalog probe at launch is often the process that
refreshes it. Killed before the rotated credential is saved, it leaves a spent refresh token in
the Keychain. The next catalog probe, before the first turn, fails to refresh and writes the empty
state back. Then the turn fails.

## Decision

- `cli_output::request` no longer kills the group once it has its answer, or once it times out.
  It closes the CLI's input. In the background, it keeps draining stdout and stderr, so the CLI
  never writes into a closed pipe while it finishes. It retires the process through
  `agent::retire_owned`, which waits up to `GRACEFUL_EXIT` (5 s) for an exit before killing what
  is left of the group.
- The ACP catalog probes share the helper and are retired the same way.

## Consequences

- A refresh started while the catalog initializes is saved, so the launch probe no longer spends
  the default login.
- A probe that does not exit on end of input lives up to 5 s longer, in the background. The caller
  gets its answer as soon as it did before.
- Two unrelated processes refreshing the same login at the same moment can still race upstream
  (ADR-162).
