# ADR-012: Typed composer preferences and picker-authorized references

**Status:** Accepted; text-only attachment admission superseded by [ADR-018](ADR-018-native-file-and-clipboard-attachments.md); fixed approval-profile restrictions superseded by [ADR-017](ADR-017-per-turn-approval-profiles.md); goal/mode lifetime and native window attachment admission superseded by [ADR-041](ADR-041-composer-modes-goals-and-window-attachments.md).

## Context

The composer combines model selection, effort, Fast, planning and explicit local references. Presentation labels and arbitrary JSON configuration cannot become process arguments. Existing native approval and workspace protections must remain effective.

## Decision

`SendPromptRequest.execution` admits only `effort`, `fast` and `planning`. Rust rejects unknown execution fields and validates effort/Fast against its own discovered catalog, tagged with the executable override used to discover it. Native checks do not trust renderer capability claims. Defaults need no catalog; a missing/stale catalog cannot authorize non-default effort/Fast. Only Cursor process arguments include native-generated parameter suffixes; the Session keeps its base model ID. The last admitted preferences are saved on the Session; qualified model preferences live in `AppSettings.modelExecution`.

- Codex uses schema-confirmed `turn/start.effort`, `serviceTier` (`priority`/`default`) and collaboration presets. Planning uses a read-only turn sandbox; regular turns retain the existing workspace-write policy. Explicit defaults clear a previous Fast/planning choice on exact resume.
- Claude uses `--effort` and a native-generated, process-only `--settings` object containing exactly one boolean, `fastMode`. Catalog capability requires both model support and no native Fast availability restriction. A bounded reason code explains account/organization/model restrictions without exposing the initialization envelope. A requested Fast turn requires initialization to confirm `fast_mode_state: on` before user input. Planning uses `--permission-mode plan`; regular turns keep `manual` and the host approval handler. Account configuration is never changed to enable paid extra usage.
- Cursor reads its native per-model parameter catalog using an initialization-only ACP request. Known effort IDs/values are retained natively; only those and an offered Fast boolean can form bracket parameters in one `--model` argv value. Renderer-supplied brackets/option-like IDs are rejected. Composer exposes Fast without manual effort; its decorative automatic bar has no fake range control. Exact legacy presets remain selectable for saved Sessions or CLIs without parameter metadata. Planning adds fixed `--mode plan`, retaining sandbox and Auto-review.
- OpenCode discovers known reasoning variants through `models --verbose`, then requires the selected model's native ACP option to offer and confirm the value before submitting input. A null effort explicitly restores the offered vendor default on exact resume. Planning requires an offered/confirmed plan mode plus child-only global/build/plan edit-denial overrides, including deprecated mode configuration. No vendor configuration file is written.
- Grok requires an installed CLI advertising `--effort`, an actually discovered model and the documented per-model effort table before adding that fixed flag. Its local runtime is unverified because the CLI is absent. OpenCode/Grok have no verified independent Fast toggle; neither model names nor arbitrary variants imply priority service. Grok planning remains unavailable.

Rapid existing-Session preset changes are serialized per Session and keep Send disabled until native selection finishes. The renderer updates native identity from the returned selection instead of retaining a foreign/cleared thread.

Approval controls describe the adapter's fixed policy. Full access remains disabled; this UI cannot broaden native permissions.

`pick_prompt_attachments(owner, folder)` is the only new filesystem entry point. It accepts an existing draft owner and a boolean, never renderer paths. One OS picker may be open at a time. Native workers canonicalize selected local paths, read regular UTF-8 files (12 KiB each, eight selections maximum), and reject special/binary files. Unix file opens use nonblocking/no-follow flags. Folder references contain at most 100 inspected entries from one directory, exclude generated folders, and never recurse/read their contents. Returned snapshots are bounded and labeled; the final prompt shares the existing 12 KiB reference limit.

Attachment snapshots, goal and planning context live in the existing Zustand store per draft owner. They transfer when a draft creates a Session, survive failed sends and newer edits, and are cleared only after their captured send succeeds or metadata is removed. They are memory-only before sending; closing the app preserves the text draft but clears these reference snapshots. Once sent, the bounded reference text is part of the persisted user message. Removing a chip never deletes a file.

Official references and current verification limits: [provider execution guide](../development/provider-execution.md).

## Consequences

- **Positive:** one composer can drive real provider options without generic execution/configuration IPC or arbitrary filesystem reads.
- **Negative:** catalogs cannot prove successful inference/account quota; unavailable Fast stays disabled, and upstream failures remain explicit. File attachments currently support text; folders supply a shallow inventory.
- **Accepted trade-off:** catalogs are cached by the existing frontend request lifecycle and retained natively for validation. Executable override changes invalidate authorization through stamp comparison. Unsent references are not persisted to disk.

## Alternatives considered

Renderer filesystem plugins, arbitrary path readers, generic protocol/config passthrough, invented presets and an unrestricted-access toggle were rejected because they widen the trust boundary. Recursive folder ingestion and persistent attachment blobs were deferred to avoid indexing costs and unexpected storage of local file contents.
