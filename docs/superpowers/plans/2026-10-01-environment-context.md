# Environment Context Implementation Plan

> Execute inline with executing-plans in the authorized shared checkout; no commit, push or delegation requested.

**Goal:** Implement pinned-message navigation, session Notepad and project instructions, with General visibility switches.

**Architecture:** Reuse existing native message bookmarks. Store bounded local reference text in native AppData.contextTexts, keyed by existing session/project identities; save via one fixed owner-validated Client command. Existing Zustand owns optimistic edits and serialized saves; provider prompts never consume this metadata.

**Tech Stack:** React, vendored Arc Textarea, existing Zustand/Client/Transport, Tauri native workers, Serde/atomic JSON.

## Constraints

- No new dependencies, plugins, capabilities, polling or automatic inference.
- Native text max 16,384 UTF-16 units and 64 KiB per owned record; empty text removes the record.
- Fixed keys session:<id> / project:<id>; renderer cannot supply filesystem paths.
- Legacy text maps default empty; visibility defaults true.
- Edit-driven 250 ms native checkpoints share existing draft gate; blur/unmount/retry explicitly flush and shutdown persists latest admitted text.
- Removed owners prune content and cancel queued edits. Errors retain user text and provide retry beside the control.
- Bookmarks expose jump/unpin only, as approved; Synara done/rename metadata remains outside this scope.

## Tasks

- [x] Add context-text ownership/bounds helpers and regression cases; use native disposable save/load fixtures to prove isolation, pruning, empty removal and no transcript/execution mutation.
- [x] Extend TS/Rust AppSettings visibility flags and native AppData.contextTexts defaults. Register save_context_text(key,value,flush) with owner and closing validation on a native worker; prune on load/removal.
- [x] Add Client.saveContextText. Generalize the existing serialized draft writer to typed payloads with optional merge and keyed errors. Context merges retain a pending flush request. Integrate setContextText/flushContextText and owner cleanup in the existing store; test stale saves, errors/retry, selection changes and deletion.
- [x] Add EnvironmentContextSections with existing Arc Textarea, native summary controls, saving/error/retry, scoped keys and message jump/unpin. Add three Orbit switches/reset keys/localized strings in General.
- [x] Extend real SSR checks for mounted/hidden content, escaped text, selected-owner bindings and associated textarea labels; run frontend/native checks and build/signature verification.
- [x] Document new metadata command/security review in ADR-030, update ADR-019/AGENTS/reference map and incremental Graphify. Leave the rebuilt desktop app ready for the owner to reopen manually, per existing no-computer-use preference.

## Interfaces

`AppData.contextTexts?: Record<string,string>`; store `contextTexts` and `contextTextStatus: Record<string,{saving:boolean,error:string|null}>`.

`save_context_text(key: String, value: String, flush: bool) -> Result<()>` only changes owner-bound local text. `Client.saveContextText(key,value,flush=false): Promise<void>`; `setContextText(key,value): Promise<void>` edits the captured owner, `flushContextText(key): Promise<void>` flushes the current store value.

`showEnvironmentPinned`, `showEnvironmentNotepad`, `showEnvironmentInstructions`: boolean, true by default; reset changes only its own flag.

`createDraftWriter<T=string>(save,onError,merge=(previous,next)=>next)` coalesces per key and never publishes cancelled errors.

## Verification

- TypeScript application/tests and ESLint passed.
- Node tests: 105 passed, 0 failed.
- Real General/Environment server renders passed: visibility, escaped text, selected owner and associated textarea labels.
- Rust fmt/check/Clippy passed; 155 tests passed, 17 opt-in live-provider tests ignored, 0 failed.
- Desktop debug bundle rebuilt with MonoCode Local Signing; deep/strict codesign verification passed.
- Incremental Graphify completed. Its existing TypeScript inline-import parser warning remains; the TypeScript compiler passes.
- No computer use, live provider inference, automatic prompt changes, commit or push. The owner can reopen the updated bundle.
