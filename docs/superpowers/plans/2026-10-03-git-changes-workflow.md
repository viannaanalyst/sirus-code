# Git Changes Workflow Implementation Plan

> For agentic workers: use the available `subagent-driven-development` skill for this one task, after the Explorer task is reviewed. This workspace has no Git metadata; root will capture a filesystem baseline and produce a unified review diff. Do not create commits or a repository.

**Goal:** Make the existing Changes dock an accessible local Git workflow: explicit prepare/unprepare, editable suggested commit title, local commit, confirmed Push and a truthful bounded commit graph/history.

**Architecture:** Add a closed session-owned native Git workspace action API for snapshots, index changes and selected diffs. Reuse current git_commit/git_push, hardening commit to reject staged files outside a nested project scope and optionally reject a stale index snapshot. The new ChangesPane is session-keyed and uses existing Client/Transport, primitives, i18n and DiffViewer. Suggestions are local deterministic metadata-based text, clearly labeled as suggestions; no inference, invented semantic summaries or provider changes.

**Tech Stack:** React/TypeScript, Rust/serde and existing Git argv helpers.

## Global Constraints

- Root AGENTS.md, ADR-004/019/040 and the UI-to-Client-to-LocalTransport-to-Rust boundary are binding. The renderer is untrusted. No frontend fs/shell plugin, generic process IPC, package, extra store or polling.
- Keep live Git workspace Changes distinct from historical per-response TurnReviewPane. Never substitute live status for retained historical reviews.
- Commit does not stage implicitly; only user actions prepare file paths. Push is explicit/confirmed and never forced. Do not mutate user repositories during verification.
- Reuse Git hook/filter/network-helper guards and literal pathspecs. All argv is fixed native syntax and user text/path values travel as separate arguments. Preserve global Git config behavior and existing authentication.
- Root is derived from a native-owned session/worktree. Validate all workspace-relative file paths; reject traversal, absolute paths, controls, `.git`, foreign or linked parents, and directory/submodule bulk admission. Only exact enumerated paths can be staged/unprepared.
- Deleted files must remain stageable through a verified existing ancestor. Renames must preserve both relevant path identities or represent the old/new paths explicitly; never silently include unrelated entries.
- A file staged and subsequently modified appears in both groups with the correct index/worktree diff. Untracked file contents must not be marked as committed; binary and conflicted states must be truthful. Unborn HEAD is supported.
- Bound native output/time through existing capture helpers. Snapshots contain at most 200 visible change entries and 50 real history commits (plus a truncation indicator); incomplete results cannot claim clean or authorize a partial whole-index commit.
- History is local HEAD ancestry, not a claim of remote freshness. No fetch, rebase, reset-hard, clean, stage-all wildcard, user remote configuration, purchases or provider inference.
- Index token is bound to canonical cwd and HEAD/index identities. Changes Commit passes the expected token and fails if preparation changed. A nested project cannot accidentally commit staged files from other paths in the enclosing repository.
- App state/session owner and canonical workspace are rechecked before snapshot publication and mutation admission. UI ignores obsolete session/worktree responses; repeated clicks cannot duplicate writes. Do not claim an OS filesystem jail or full protection against external concurrent Git changes.
- Keep English documentation and pt-BR/en application UI. Existing sessions/settings/types remain compatible. No model-generated title is claimed: root asked user about IA/local preference and, after reasonable wait, stated assumption local.

### Task 1: Bounded Git workspace workflow

**Files:**
- Create `src-tauri/src/git_workspace.rs` for closed native actions/snapshots/fixtures; modify native `git.rs`, `commands.rs`, `lib.rs` only as required to expose bounded guarded helpers and extend optional commit guard.
- Modify `src/client/types.ts` / `src/client/index.ts` for matching typed API and optional expected index token on gitCommit.
- Create `src/components/ChangesPane.tsx` and focused child components only where they separate responsibilities (e.g. history/list).
- Modify `src/components/RightDock.tsx` to use the new session-keyed ChangesPane and make Changes available in its launcher/menu.
- Modify `src/components/DiffViewer.tsx` only if an optional hideFileList presentation prop avoids duplicated list rows; preserve default behavior for historical review callers.
- Add local title utility `src/lib/commit-title.ts`, focused metadata tests, `src/i18n/git-workspace-strings.ts` and dictionary registration.

**Interfaces:**
```typescript
// Match a closed serde enum; no renderer argv or protocol passthrough.
type GitWorkspaceAction =
  | { type: "snapshot"; sessionId: string }
  | { type: "stage" | "unstage"; sessionId: string; paths: string[]; expectedIndex: string }
  | { type: "diff"; sessionId: string; path: string; staged: boolean; expectedIndex: string };
// Responses are tagged snapshot/diff; adapters refuse mismatched response types.
// Snapshot contains owned GitIdentity/head/indexToken, staged and unstaged entries,
// truncated flag, ahead/behind, conflicts/outside-scope state, real local history.
// File entry includes FileChange metadata plus any original rename path needed.
// History entry: hash, parent hashes, subject, author, authored time and bounded refs.
gitCommit(sessionId: string, message: string, expectedIndex?: string): Promise<GitCommitResult>;
```
Native request/response types may live in git_workspace rather than grow models.rs; keep camelCase shared schemas aligned. Preserve the existing gitCommit callers without requiring a renderer-selected cwd.

- [ ] Add meaningful disposable Git tests: stage a selected file while leaving another untracked untouched; unstage preserves working bytes; already-staged+modified diff separation; spaces and literal pathspec-like names; deletion/rename; unborn HEAD; nested scope with foreign staged file; stale index token; truncated/invalid/conflicted snapshots; history parents/merges and bounded output. Run the targeted failing tests before implementing the missing action.
- [ ] Implement bounded snapshots and parsing with actual staged/worktree metadata, native owner/root validation and existing guards. Stage/unstage validate the current enumerated paths and token, mutate index only, and return a fresh snapshot. Unstage can use fixed `git reset -q -- <paths>`: root verified it works before the first commit and preserves the worktree.
- [ ] Extend explicit local commit with a native index/scope guard. The entire native staged set must be reviewable and confined before commit. Optional expectedIndex keeps existing callers compatible while Changes refuses stale preparation. Preserve no-auto-stage and no-force push behavior.
- [ ] Add Client APIs and ChangesPane with branch/ahead/behind, Refresh, an editable bounded commit-message field with local suggestion button, staged/unstaged file groups with per-file plus/minus and explicit prepare-all of enumerated paths, Commit and confirmed Push. Keep Commit disabled until a nonempty title and valid staged state. Clear only the captured successful message revision; preserve edits made during requests and discard stale navigation results.
- [ ] Diff selection reads the matching staged or working snapshot, displays bounded escaped text through the existing viewer, and handles errors/loading without substituting the wrong path or scope.
- [ ] Add a collapsible local commit history/graph using actual parent identities and refs. Graph edges only connect observed parents; do not draw a fictitious straight parent chain across merges or truncated boundaries. Subject/author/hash are escaped and bounded. Do not add fetch or remote-history claims.
- [ ] Local suggestions use only captured staged file metadata, clearly labeled and editable. Preserve user's edits if preparation changes while generating. Do not send staged contents to a provider. Include focused tests for empty set, one file, multiple paths, additions/deletions/mixed changes and bounded Unicode titles.
- [ ] Add a fixture preview using the real ChangesPane and FileTree with a bounded mock Client, including create file/folder, collapse, prepare/unprepare, suggestion/commit/push/history/dirty diff states. Label it as simulated and do not call real Git or providers. Root can integrate the preview if it is outside this task's reasonable time.
- [ ] Run focused Git fixtures, typecheck/lint, appropriate existing diff/review/editor checks. Record exact results and security limitations in `/tmp/switchyard-git-workflow-report.md`.

**Documentation/review:** Root owns the ADR, AGENTS, final whole-feature review package, full checks and incremental Graphify update. Do not edit the Explorer implementation or unrelated ongoing features.
