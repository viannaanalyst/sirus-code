# ADR-030: Owner-bound Environment references and bookmark navigation

**Status:** Native persistence retained; Environment reference UI withdrawn

## Context

The Environment card needs a useful place for settled assistant bookmarks,
session notes and project conventions. These references must survive restart
without changing provider prompts, transcripts, execution or files in a checkout.
The existing composer draft mechanism already owns bounded, edit-driven JSON
checkpoints; adding a separate database or a timer would duplicate that lifecycle.

## Current product surface

The Environment card no longer mounts Pinned messages, Project instructions or
Notepad. General omits their corresponding visibility controls. Existing native
context text, bookmarks and legacy settings are retained; removing these UI
sections does not discard saved content or change provider inputs. The original
implementation below documents the retained persistence and former surface.

## Original decision

`EnvironmentContextSections` exposes message jump/unpin actions over the existing
native `Session.pinnedMessageIds`. It resolves only nonempty settled assistant
messages owned by the current session. It adds no bookmark completion or rename
metadata and reuses the existing serialized pin command and transcript jump.

Native `AppData.contextTexts` stores Notepad under `session:<id>` and project
instructions under `project:<id>`. Legacy state defaults to an empty map. Notes
are not copied into a fork/handoff; project instructions remain shared by sessions
that belong to that project. Both are local reference text, not provider input,
composer drafts, recap context or writes to `AGENTS.md`.

The sole new IPC is `save_context_text(key, value, flush) -> Result<()>`, reached
through `SwitchyardClient` and `LocalTransport`. `context_text.rs` validates exact
existing owners (including a session's project), keys up to 256 bytes, text up to
16,384 UTF-16 units and 64 KiB. Empty text removes the record. Load and metadata
removal prune orphaned, empty or oversized entries.

The command runs on a native worker, holds the existing AppData lock, checks the
closing guard before admitting an edit and shares the composer draft checkpoint
gate. Incoming edits checkpoint at most every 250 ms; blur, unmount and retry
request an explicit atomic flush. Shutdown saves the latest admitted AppData.
There is no idle timer or polling. The UI uses the existing Zustand store and
serialized writer, retaining only the latest queued value per owner and preserving
any queued flush request. Removal cancels pending writes; late errors cannot
recreate removed content. Persistence errors retain the admitted text in memory
and expose an inline retry. The UI says Autosave rather than claiming every
admission is already durable.

General persists `showEnvironmentPinned`, `showEnvironmentNotepad` and
`showEnvironmentInstructions` through existing settings saves. Each defaults to
true for legacy state. General's page reset restores these visibility flags
without deleting reference content. Hidden sections unmount; hiding
does not delete their content. Arc Textarea retains an associated label,
length/status hint, error description and keyboard-visible focus.

### Security review

The webview chooses only a bounded key and text for metadata it already owns.
Rust resolves the owner under the same lock as insertion; keys never become file
paths. Only the native app-data JSON path is written. No new capabilities,
plugins, network access, credential reads, process arguments or provider input
paths are added. Text is rendered as escaped text, never HTML. The void response
cannot overwrite a newer Session lifecycle snapshot.

## Consequences

- **Positive:** restart-safe references with clear project/session ownership,
  direct access to real bookmarks and no second state store or prompt authority.
- **Negative:** project instructions do not automatically reach a model; an
  explicit context-admission feature would need its own design. Synara bookmark
  completion/rename and copying instructions into notes remain outside this scope.
- **Accepted trade-off:** an abrupt crash between edit-driven checkpoints can
  lose the latest edit; blur/owner changes flush and normal shutdown persists all
  latest admitted references.

## Alternatives considered

Renderer storage would bypass native ownership and shutdown persistence. Treating
notes as composer drafts or prompt prefixes would mix reference editing with
model authority. Writing instructions to checkout files would create unrequested
workspace changes. All were rejected in favor of owned app-data metadata.
