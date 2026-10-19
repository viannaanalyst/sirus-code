# ADR-147: Large command output is stored apart and loaded when the row opens

- Status: accepted
- Date: 2026-10-19

## Context

A command row keeps the end of its output (at most 60 lines and 3,000 characters, ADR-035/ADR-070), shown only when the person opens the row. In the owner's `state.db` (1,061 messages, 12.2 MB of message JSON), turn activity was 10.7 MB: 4.4 MB of command output across 4,102 rows and 4.4 MB of turn review diffs. Every load of a transcript parsed all of that output, the native process and the web view then held it, and almost none of it is ever opened. No output was over 4 KiB (the 3,000-character cap), so a 4 KiB threshold would have moved nothing; 1,650 outputs were over 1 KiB and held 3.6 MB.

## Decision

- **What moves.** A command row whose state is settled (not `running`) and whose output is over 1 KiB (`tool_output::APART_BYTES`) is saved with only its last 6 lines, at most 480 bytes, in the message row (`output`), plus `outputBytes`, the full size. The preview is the end, not the start: the stored output is already the end of the command's output, and the result and errors are there. The full text goes to a new table, `tool_outputs (session_id, message_id, step_id, text, bytes)`, primary key on the three ids. `step_id` is the activity row's id (only top-level command rows carry output; subagent steps and workflow members carry none).
- **Where it happens.** Only at the storage boundary: `store.rs` encodes each message through `tool_output::split` and writes the moved outputs in the same transaction as the message row, only when that row is written (an unchanged row writes nothing; unchanged output text is not rewritten). In memory nothing changes while the process holds a transcript; the light form arrives with the next read from the database. A running row and a streaming turn keep their output in memory as before; their completed rows move at the next save.
- **Keeping it consistent.** A written row prunes the outputs of rows it no longer marks as stored apart. A message replaced at its position or cut off the end loses its outputs (unless it only moved position); an unknown transcript rewritten whole keeps only the outputs of messages it still has; deleting a session deletes its outputs.
- **Existing rows.** Schema version 6 creates the table and splits every older row once, at open, inside the migration's transaction, operating on the JSON so no other field is touched (`split_value`, tested to produce exactly what a save would). Only rows longer than 1 KiB containing `"output":` are parsed. On the owner's database this takes 197 ms once (release build). A lazy split on re-save was rejected: finished transcripts are rarely rewritten, so most of the bytes would never move.
- **Fetching it.** `transcript_action { type: "toolOutput", sessionId, messageId, stepId }` (the closed, `deny_unknown_fields` action enum, so phones and the headless host get it with the same checks) answers `{ type: "toolOutput", text }`: from the loaded transcript when it still holds the whole text, otherwise from `tool_outputs`; ids are bounded and the answer is at most 1 MiB (its end). The session must belong to a project that still exists. The state lock is held only to find the row.
- **Renderer.** An opened row with `outputBytes` shows the preview under "Show full output (3 KB)"; the click fetches the text (`ToolOutputBlock.tsx`, loading and error states with Try again) and replaces the preview. Fetched outputs stay in a 48-entry most-recently-used cache with one request per row at a time (`src/lib/tool-output.ts`). Rows learn their message through `AgentActivity`'s `message` prop.
- **Copies and exports.** Export, search, copy and the handoff recap read message text only, so they lose nothing. A fork copies messages under new ids, so `restore_fork` puts the stored outputs back into the copy before it is saved; the copy then stores them under its own ids. Moves to another computer copy text only (ADR-133). A `lite` transcript (phones) drops output and `outputBytes`.

## Consequences

Measured on a copy of the owner's database (`tool_output::measure`, `#[ignore]`, release build), for the largest session (548 messages):

| | Before | After |
|---|---|---|
| Load (read and parse its rows) | 11.5 ms | 6.1 ms |
| Transcript held, as JSON | 3.67 MB | 2.25 MB |
| Command output held | 1.95 MB | 0.56 MB |

All message rows went from 12.2 MB to 9.0 MB; 1,666 outputs (3.7 MB) moved. The file grows by about the moved bytes until the freed pages are reused or given back (ADR-143).

- Opening a row with a long output costs one small read; its text is then cached.
- The rest of a turn's bytes are turn review diffs (4.4 MB), unchanged here; they could move the same way.
- Tests: preview bounds, which rows move (settled and over the threshold only), the migration split equals the save split, a save stores apart and a reload is light while the stored text stays through later saves, the action reads from memory or the store and refuses unknown or empty ids, removed messages and sessions delete their outputs, the version 6 migration splits older rows once, a fork restores the outputs; in the renderer, sizes, keys and the cache (one fetch per row, most recent kept, a failure retried).
