# ADR-018: Native file snapshots and explicit clipboard attachments

**Status:** Accepted. Supersedes the text-only attachment admission in [ADR-012](ADR-012-composer-execution-and-attachments.md).

## Context

Images pasted into the composer became raw paths, and the picker rejected every binary file. Adding a renderer-selected path reader would bypass the webview trust boundary. Files must remain user-selected data, with bounded storage and unchanged provider approval profiles.

## Decision

`attachments.rs` owns opaque attachment IDs and private, read-only temporary copies of regular files. Any extension is admitted, including PNG/JPEG/GIF/WebP, PDF, CSV and DOCX; admission does not promise that every model can interpret every format. Up to eight attachments and 40 MiB enter a turn, with a 10 MiB per-file limit. Image header dimensions are checked before decoding (8192 per edge, 32 million pixels). Folders retain the shallow, bounded names-only snapshot from ADR-012. Text context remains bounded at 12 KiB. The process-wide registry is bounded at 256 entries/256 MiB and has no polling.

The fixed Client commands are:

- `pick_prompt_attachments(owner, folder?)`: immediately opens the OS chooser. macOS uses an `NSOpenPanel` that selects files and directories together when `folder` is omitted. The other hosts retain the existing separate native file/folder picker APIs.
- `paste_prompt_attachments(owner, files, expectedText?)`: accepts bounded named byte uploads from a browser paste event. Renderer paths, URLs, MIME declarations and executable flags are unavailable. On macOS, native clipboard file URLs, PNG/TIFF images and an exact pasted local-path string require a once-only native Command-V admission, matching the native pasteboard change count and expiring after three seconds. The local AppKit monitor observes only this app, never swallows the event and is removed at exit. Remote/multiline paths are rejected. Ordinary text retains normal paste behavior.
- `release_prompt_attachments(owner, ids)`: removes only that owner's unsent cache entries. Frontend drafts release an ID only after its last draft reference disappears; metadata retains the original native owner through draft transfer. Admitted turns retain snapshots until owner removal or shutdown, so clearing a related draft cannot break native continuation. Failed attachment additions release their entries.

The image viewer can annotate an admitted image with a pointer-drawn markup rendered into a local PNG. The renderer uploads it through the same bounded byte admission (`paste_prompt_attachments`) under a derived `*-annotated.png` name, so native magic-byte/MIME resolution, dimension bounds, owner binding and the 10 MiB/40 MiB limits are unchanged. Confirming replaces the draft chip in place and releases the original unsent snapshot; the original bytes are not retained. No new IPC command, filesystem permission or path reader is added.

`send_prompt` admits attachment IDs belonging to the selected session or its project draft, rejects foreign/duplicate/unknown IDs and rechecks count/bytes before committing the user turn. The project draft can transfer into a newly created session without losing references on startup failure. Owner removal prunes the registry. Normal shutdown unlinks native-generated temporary paths explicitly, including files still held by process tasks. Crashes can leave temporary files for OS cleanup. Binary data, preview URLs and cache paths are never saved to `state.json` or logs; transcript text retains selected filenames and bounded text, not binary payloads. Temporary file references need reattachment after app restart; transcript forks do not reconstruct binary content.

Native protocol construction stays in Rust:

- Codex app-server uses schema-confirmed `localImage` blocks pointing to owned snapshots.
- Claude stream-json uses base64 image/document source blocks for images/PDF; other formats remain native file-tool references.
- OpenCode ACP checks offered `image`/`embeddedContext` capabilities and sends image or embedded blob blocks. Unsupported capabilities fail explicitly. Model-level media restrictions remain the provider's responsibility.
- Cursor/Grok keep real owned local-file references in their existing text adapter. No unverified image flag is invented and no generic binary is stuffed into prose as base64. Their CLI tools and selected model determine interpretation.

All providers also receive quoted native snapshot paths for their file tools. Selecting attachments does not grant filesystem, network, execution or Full access. Existing approval profiles and vendor denials continue to apply, including external-file restrictions. Office/archive/media formats may require provider tools; the host does not run arbitrary converters or execute attachments. PNG/JPEG/GIF/WebP previews are displayed from bounded data URLs under the existing CSP. Binary formats have compact filename chips.

The only added direct dependencies are already present transitively: `tempfile` for private file lifetime and macOS-only `objc2`/AppKit/Foundation/`block2` for the combined picker, native pasteboard and paste admission. No frontend filesystem/shell/clipboard permission or plugin is added.

## Consequences

- **Positive:** Paste and picker share native, owner-validated file snapshots and actual multimodal image payloads; source files and Git trees remain untouched.
- **Negative:** Temporary snapshots consume bounded native storage and are not durable conversation attachments. CLI/model format support varies.
- **Accepted trade-off:** Admit arbitrary regular-file formats without pretending they are UTF-8 or weakening CLI policies. Retain bounded textual fork behavior until durable binary transcript ownership is designed separately.

## References

- [ACP content blocks](https://agentclientprotocol.com/protocol/content) and [initialization capabilities](https://agentclientprotocol.com/protocol/initialization).
- [OpenCode ACP content conversion](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/acp/content.ts).
- Codex installed app-server `generate-json-schema`, `v2/TurnStartParams.json` (`localImage`).
- [Claude Code programmatic input](https://code.claude.com/docs/en/headless).
