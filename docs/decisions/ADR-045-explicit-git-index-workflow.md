# ADR-045: Explicit index preparation and bounded local Git history

**Status:** Accepted

## Context

The live Changes dock lists combined working changes but cannot select the files
for a commit. Commit and Push already exist in the Environment card. Moving the
workflow into Changes requires separate index/worktree views and a guarantee
that a nested project cannot commit staged files outside its workspace. Retained
per-response reviews must remain historical rather than become live Git views.

## Decision

- `git_workspace_action` is a closed session-owned Snapshot/Stage/Unstage/Diff
  API in `git_workspace.rs`, reached only through Client/Transport. Native code
  derives the canonical session cwd and rechecks live ownership before mutation
  admission and before publishing results. No renderer Git argv, cwd, remote or
  shell authority is added.
- Snapshots separate staged and unstaged entries; a file can appear in both.
  Index and worktree diffs are distinct. Rename detection is disabled for the
  preparation list so deletion and addition are explicit paths rather than a
  hidden second identity. Exact current enumerated files are eligible; linked
  paths, directories, submodules and invalid names are not. Deleted leaves use
  the verified existing ancestor. Preparation changes only the index, and
  unpreparing preserves working bytes, including before the first commit.
- Native capture bounds output and deadlines and retains hook/filter guards
  and literal pathspecs. At most 200 change entries and 50 local HEAD ancestry
  commits are published. Truncation and conflicts cannot authorize a whole-index
  commit. Counts without a known upstream remain unknown. There is no automatic
  fetch or claim that locally retained remote refs are fresh.
- The index token binds the canonical cwd, Git directory, HEAD, symbolic branch
  and the full logical index. Changes sends the expected token when preparing,
  unpreparing, reading a diff or committing. Native Commit also checks the entire
  staged set and refuses entries outside a nested workspace; legacy Environment
  callers retain the optional-token signature but receive the same scope guard.
  App-owned index writes are serialized. Commit never stages implicitly.
- `ChangesPane` uses transient session/worktree-keyed state, a synchronous write
  gate and obsolete-read guards. It provides explicit per-file/all-enumerated
  preparation, an editable title, Commit and confirmed Push. Successful commits
  clear only the captured message revision, preserving later typing. Push keeps
  the existing origin/authentication and network-helper guards and never forces.
- Title suggestions are deterministic local text based on staged filenames and
  change kinds. They do not read contents or invoke a provider and are labeled
  as editable suggestions. `GitHistory` draws edges only to observed actual
  parent hashes; absent parents are not replaced by a fictitious straight chain.
  Historical `TurnReviewPane` behavior remains governed by
  [ADR-040](ADR-040-native-turn-change-review.md).

## Consequences

- **Positive:** choosing files, inspecting the correct diff and committing are
  reviewable in one dock, while native session ownership and staged-only commits
  remain authoritative. There are no new credentials, plugins or dependencies.
- **Negative:** large/incomplete Git snapshots and unsafe configured operations
  fail closed. Rename preparation requires selecting its deletion and addition.
  Suggestions describe filenames/kinds rather than infer the meaning of edits.
- **Accepted trade-off:** tokens and path/config guards are admission checks,
  not a transaction against external Git processes or an OS filesystem jail.
  External changes after the final check can still race Git. A mutation may have
  succeeded when a later refresh or ownership recheck fails; no rollback, index
  lock deletion or automatic retry is attempted.

## Alternatives considered

- Commit all working changes implicitly: rejected because preexisting work and
  parallel sessions must remain reviewable.
- Treat the historical turn review as live status: rejected because that loses
  the before/after boundary and substitutes unrelated current changes.
- Provider-generated titles follow the explicit isolated utility boundary in
  [ADR-046](ADR-046-provider-generated-commit-titles.md).
- Automatic fetch or force Push: rejected by the existing Git safety contract.

This decision extends the Changes launcher and staged-only Commit flow in
[ADR-019](ADR-019-header-environment-dock-and-editors.md) and preserves
[ADR-004](ADR-004-git-argv-no-destructive-defaults.md).

## Amendment (2026-10-03): older history pages

Local history still loads the newest 50 commits with each snapshot. **Load older commits** calls the closed `git_workspace_action { type: "history", sessionId, from, skip }`.

- `from` must be a full hex commit hash, namely the snapshot's own `head`. Pages continue from the commit the view loaded, so new commits cannot shift or repeat rows.
- Each page is 50 rows and is revalidated against Git's hash-only ancestry exactly like the first page.
- `skip` above 5,000 returns nothing, and the renderer keeps at most 5,000 extra rows.
- A new snapshot discards loaded pages.
