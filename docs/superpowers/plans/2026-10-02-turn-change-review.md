# Turn change review implementation plan

**Goal:** Ship approved 01 compact summaries with Keep and Review in the existing dock.

**Architecture:** Native admission takes a bounded read-only workspace baseline before spawning a provider. After owned process/tool cleanup, native compares snapshots and attaches historical diffs to the exact assistant activity. Keep acknowledges that review only; the UI opens session/message-bound history in the existing dock.

**Constraints:** No rollback, staging, commit, arbitrary path IPC, new frontend native imports or capabilities. Preexisting dirty contents are the baseline. Concurrent writers cannot be attributed to a provider. Missing/truncated captures must be visible; old conversations gain no invented changes.

- [x] Native capture/diff: `turn_review.rs`, `activity.rs`, `commands.rs`, provider constructors/monitors. Fixed read and memory/time bounds, descriptor jail, Git tracked/unignored names or bounded non-Git walk, exact response ownership. Compare fixtures with dirty baselines, additions/deletions/binary and concurrent/incomplete reads.
- [x] Native acknowledgment and retention: closed `keep_turn_changes(sessionId,messageId)`, persisted acknowledgment, last 16 full reviews per session; older counts retained with unavailable diffs. Clear inherited review ownership on transcript forks. Test foreign IDs, repeat Keep and persistence.
- [x] UI: `TurnChangeSummary.tsx`, `TurnReviewPane.tsx`, typed client/store fields and localized strings. Expanded compact list (first 3 files), show more, Keep pending/error state, historical read-only DiffViewer in session-bound dock tab.
- [x] Verify TypeScript, lint, frontend tests/build and Rust fmt/check/clippy/tests. Update ADR/AGENTS and incremental Graphify. Build reviewable desktop bundle.

Execution proceeds inline under the user's existing authorization. No Git commit is possible in this checkout (no .git directory).

Verification evidence: 170 Node tests and all frontend verification scripts passed; 234 native tests passed with 18 opt-in live integrations ignored. The final 10 turn-review tests also passed, including failed Keep persistence and ignore/index membership changes. TypeScript, lint, frontend/desktop builds and formatting passed. The generated macOS bundle has a valid local signature. Graphify was updated incrementally (6,020 nodes / 14,251 edges); its known partial AST extraction of the large store remains separate from the passing TypeScript compiler. Native paid-provider and manual desktop UI testing were not run.

Final gate: `cargo clippy --all-targets -- -D warnings` passed on the final sources; `cargo fmt --check` and macOS signature verification passed. Completed.
