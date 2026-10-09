# ADR-100: Native process hygiene for agents, Git and GitHub reads

**Status:** Accepted

## Context

Several small native problems showed up while agents ran for a long time, most of
them already fixed in T3 Code and Synara:

- Codex received the browser and computer MCP session tokens as `-c` values, so
  any local user could read them in `ps`.
- Sirus polls `git status` and `git diff` while agents run Git in the same tree.
  A status that refreshes stat data takes `.git/index.lock`, and an agent's
  `git add` or `commit` could fail on it. An untracked build tree also sent tens
  of thousands of rows to the UI.
- Stop and Quit killed the agent's process group. Descendants that start their
  own group or session (Claude background shells, MCP servers, daemons) survived.
- The Mac could idle-sleep in the middle of a long turn.
- Agent CLIs (and the builds and tests they start) ran at the same priority as
  the UI.
- The review inbox, PR context, PR watches and CI auto-fix each ran `gh` on
  their own, with no shared concurrency limit, and kept calling GitHub after a
  secondary rate limit.

## Decision

- **Codex MCP tokens.** `SIRUS_BROWSER_TOKEN` and `SIRUS_COMPUTER_TOKEN` are set
  in the Codex process environment and forwarded to each MCP server with
  `mcp_servers.<name>.env_vars = ["…"]` (supported by Codex CLI 0.162). Socket
  paths stay in `-c` (not secret). Tests check that no token is in the built argv.
- **Git.** Every native Git command runs with `GIT_OPTIONAL_LOCKS=0`. `git::status`
  counts lines with plumbing `git diff-index -M --numstat HEAD` (porcelain `diff`
  still rewrites the index), which is guarded like `diff` against external
  filters. It lists at most 2000 untracked files (`git::MAX_UNTRACKED`) and sets
  `GitStatus.untrackedTruncated` when it drops the rest.
- **Process trees** (`process_tree.rs`). `AgentProcess::stop` (Stop and Quit)
  snapshots the agent's descendants (`ps -A -o pid=,ppid=,pgid=`) while the leader
  is still unreaped, kills the agent's group as before, sends SIGTERM to every
  descendant outside that group and SIGKILLs survivors after 1.5 s. Survivors are
  matched on PID, group and parent (or launchd), so a reused PID is never hit.
  Quit waits at most 0.5 s for pending stops, then SIGKILLs what is left.
- **Keep awake** (`keep_awake.rs`). Each turn's monitor holds an IOKit
  `PreventUserIdleSystemSleep` assertion, shared and reference-counted; the last
  turn to end releases it, and Quit releases it too. The display still sleeps.
  The remote-access `caffeinate` for paired phones is unchanged.
- **Priority.** Every agent CLI is reniced by +5 right after spawn, from the
  shared turn monitor, so its children inherit it. PTY terminals keep the normal
  priority.
- **GitHub read gate** (`gh_gate.rs`). Every `gh` read (GraphQL queries and GET
  calls in `github_inbox.rs`, which PR watch and CI auto-fix also use, and
  `pull_requests.rs`) runs through one gate: at most 5 at a time; once any `gh`
  call reports a rate limit (HTTP 429, "rate limit", abuse detection) every read
  fails fast for 60 s; an identical successful read from the last 10 s is
  reused. Writes bypass the gate but clear the reuse cache.

## Consequences

- An agent's shell commands can still read the tokens from the Codex
  environment. That is the same reach the MCP tools already give the agent, but
  other local users no longer see them.
- A status that skips the stat refresh may re-hash files whose metadata changed;
  this costs more on very large trees but never blocks an agent.
- The UI does not show `untrackedTruncated` yet; `src/client/types.ts` needs the
  optional field before it can say "and more".
- Escaped descendants get up to 1.5 s to exit after Stop. A process that leaves
  the tree by double-forking before the snapshot is not reached.
- A refresh within 10 s of an identical read shows the reused answer.
