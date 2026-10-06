# Explorer Actions Implementation Plan

> For agentic workers: use the available `subagent-driven-development` skill to implement this task and review it before the Changes task. This workspace has no Git metadata; use the captured filesystem baseline for review and do not create a repository or commits.

**Goal:** Add New file, New folder and Collapse all to the existing owned session Explorer, with no search button.

**Architecture:** FileTree retains local transient selection/expansion and its existing lazy listDir flow. A closed owner-scoped native command creates a single empty file or directory within the session worktree; the existing editor opens new files. No native fs/shell plugin, store, polling or package is added.

**Tech Stack:** React 19, TypeScript, existing primitives and i18n, Tauri 2, Rust/libc.

## Global Constraints

- The renderer is untrusted; only LocalTransport imports Tauri APIs.
- The workspace root derives from the native-owned session and project. Reject unknown/deleted owners and foreign parents.
- Creation is explicit and non-overwriting. No deletion, rename, extraction, filesystem command strings or recursive mkdir.
- A single printable leaf name is bounded to 255 UTF-8 bytes; reject empty/whitespace, dot/dot-dot, separators, controls, reserved `.git` and hidden heavy directories.
- Directory traversal uses no-follow verified handles on Unix, rejects linked parent components, and exclusive creation refuses files/directories/links already at the target. Do not truncate or write existing files.
- Preserve lazy enumeration, ownership cancellation, keyboard labels/focus and existing context-menu Copy path.
- Docs are English, UI supports pt-BR and en. Existing settings and sessions remain compatible.

### Task 1: Owned Explorer creation and collapse

**Files:**
- Create `src-tauri/src/workspace_entries.rs` for bounded filesystem creation and fixture tests.
- Modify `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/models.rs` for the closed command, allowlist and kind enum.
- Modify `src/client/types.ts` and `src/client/index.ts` for the matching API.
- Modify `src/components/FileTree.tsx` to add the three actions and creation form; create a small child form component only if it improves readability.
- Add `src/i18n/explorer-strings.ts` and register it in `src/i18n/index.ts`.

**Interfaces:**
```typescript
export type WorkspaceEntryKind = "file" | "directory";
createWorkspaceEntry(sessionId: string, kind: WorkspaceEntryKind, name: string, parentPath?: string): Promise<FileEntry>;
```
```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceEntryKind { File, Directory }
// Command args: session_id, kind, name, parent_path: Option<String>.
// Root resolved through commands::session_cwd inside native_task.
// Return existing models::FileEntry.
```

- [ ] Add fixture tests for empty creation, nested parents, duplicate refusal without modifying contents, traversal/reserved/overflow names, foreign parents and Unix symlink parents/leaves. Run targeted tests first to verify the missing creation path fails.
- [ ] Implement creation through a native-owned session root and verified no-follow directory handles with exclusive empty-file or mkdir admission. Existing owners must remain valid at mutation admission. Return FileEntry only after verification; report limitations candidly in the implementation report.
- [ ] Expose the closed command through Client and existing LocalTransport only; keep shared types aligned.
- [ ] Add a compact toolbar to FileTree with FilePlus, FolderPlus and collapse icon via IconButton. Folder selection determines the parent; selected file targets its containing folder; default is the workspace root. Show destination in the bounded creation form. Enter creates, Escape cancels; retain the name on failure and restore focus after close. Repeated clicks while pending must not duplicate creation.
- [ ] Collapse all closes expanded directories, clears descendant selection and returns to the root; do not re-enumerate the whole workspace or add search.
- [ ] After success refresh visible directory listings, expand the selected parent, select the new entry and open a new file in the existing editor through onOpenFile. Guard late results against session/worktree changes or unmount so a response cannot overwrite the next workspace UI.
- [ ] Run focused native fixture tests, frontend typecheck/lint and existing sidebar/editor checks where the change touches their contracts. Do not run paid inference or Git mutations on user repositories.
- [ ] Write a report with modified files, exact verification commands/results and security limitations to `/tmp/sirus-explorer-report.md`.

**Review baseline:** `/tmp/sirus-explorer-before/`. Root agent will generate a unified diff, review this task, update ADR/AGENTS, run final checks and update Graphify.
