# ADR-074: Project scripts and worktree cleanup

**Status:** Accepted

## Context

A new isolated worktree is a bare checkout: no `node_modules`, no `.env`. Every session started there spends its first turn installing dependencies, or fails. Finished worktrees also pile up under the worktree location: a session deleted without its worktree, a removed project or an interrupted removal leaves folders that no session references, and archiving never released anything. T3 Code (PR #16290) runs a project action when a worktree thread settles; Synara (commit `3bc6468e8`) prunes Git metadata on removal and can release a worktree when its task is archived.

## Decision

**Project scripts.** `Project.scripts` holds two optional shell scripts, Setup and On finish (at most 8 KiB each, trimmed, no NUL; omitted from JSON when empty). The owner edits them in the Edit project dialog and they are saved with it through the closed `project_scripts_action` (`save`, `run`, `cancel`, `dismiss`). Nothing runs until a script is saved.

- They run only in a session's **own isolated worktree**, never in the project checkout or for side chats, as the person, like the terminal: `$SHELL -l -c <script>` in the worktree, in its own process group, stdin closed, with `SIRUS_PROJECT_ROOT`, `SIRUS_WORKTREE_PATH` and `SIRUS_SESSION_ID`. No approval or sandbox applies: these are the owner's scripts.
- **Setup** is due once per new worktree: `create_session_locked` (so also Team helpers, automations and Astros), forks and handoffs into a new worktree set `Session.scripts.setupPending`. `send_prompt` admits the turn (`starting`, the user message visible), then `before_turn` runs Setup (10-minute limit) before the provider starts. A failure, timeout or Stop never fails the turn by itself: the turn continues and the run stays visible with Run again.
- **On finish** runs after each turn that completes or fails (not after Stop), with a 2-minute limit. A turn sent while it runs waits for it.
- `Session.scripts.runs` keeps the latest run of each kind with status, exit code and the last 16 KiB of combined output (colour codes and redrawn progress removed). A row above the composer shows it, with Show output, Run again, Stop and Dismiss. Runs left `running` by a closed app load as `cancelled`; Stop, delete and shutdown kill the process group.

**Worktree cleanup.** `worktree_cleanup_action` (`scan`, `clean`, `releaseArchived`) lives in `worktree_cleanup.rs`.

- Every confirmed worktree removal now also runs `git worktree prune` and removes the project folder under the worktree location once it is empty.
- Settings → Worktrees → **Clean up leftover worktrees** lists folders under the automatic and custom locations (only `{projectId}/{folder}` with a UUID project folder) that no session references, with the space they use, and asks for confirmation. Empty folders and clean linked worktrees are removed (`git worktree remove`, no `--force`, run from their main checkout, the reference re-checked under the state lock first). Folders with uncommitted or untracked changes, or that Git cannot verify, are kept and counted. Branches are never deleted.
- **Release the worktree when a session is archived** (`AppSettings.releaseWorktreeOnArchive`, off by default). After an archive is saved, the renderer asks the native side to release that session's isolated worktree. It is removed only when the session and its side chats are idle, no other session or open terminal uses it, it has no uncommitted or untracked changes and its HEAD is on another local branch or a remote-tracking branch (merged or pushed). Otherwise it stays and a toast says why. The branch always stays.

## Consequences

- **Positive:** a new worktree can be ready for its first turn (`npm install`, copied `.env`) without a wasted turn; disk space from finished work is recoverable without a terminal.
- **Negative:** Setup delays the first turn of a new worktree by up to 10 minutes; a long On finish delays the next send by up to 2 minutes. Script output persists in `state.json` (up to 32 KiB per session until dismissed).
- **Negative:** archiving is no longer purely a navigation preference when the setting is on (ADR-029). A restored session whose worktree was released has no working folder; its branch is kept so the work can be checked out again.
- **Accepted trade-off:** scripts run unsandboxed as the person, exactly like typing them in the terminal; only the owner can save them.

## Alternatives considered

- **Running Setup when the worktree is created.** Rejected: the landing creates the session on the first send anyway, and gating the turn in `send_prompt` covers every creation path (Team, automations, forks, handoffs) in one place.
- **Blocking the turn when Setup fails.** Rejected: the person may not need the setup for this turn; the failure is shown and can be retried.
- **Force-removing dirty leftovers or deleting merged branches.** Rejected by ADR-004.
