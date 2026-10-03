# ADR-039: Owner-bound document reading in the right dock

**Status:** Accepted. Extends [ADR-018](ADR-018-native-file-and-clipboard-attachments.md) and [ADR-019](ADR-019-header-environment-dock-and-editors.md).

## Context

Binary attachments had filename chips but no readable view. The owner selected a side panel so documents can be read beside the conversation, including project drafts that have no session yet. The renderer must not gain a general filesystem reader or execute Office content.

## Decision

`attachment_preview(owner, id)` is one read-only IPC command registered in `lib.rs` and exposed through `SwitchyardClient`. The inputs are existing owner keys and opaque attachment IDs, never paths or URLs. Rust checks a live project/session and an exact registry owner, holds the private snapshot during reading, and rechecks ownership and snapshot identity before returning. Removed/released IDs cannot publish a pending preview. A single non-queuing parse permit stays with the blocking task even if its caller is cancelled. The command adds no capabilities, plugins, provider privileges or persistence fields.

`document_preview.rs` returns a tagged PDF/base64, Word/blocks or spreadsheet/sheets response. PDF bytes retain the existing 10 MiB snapshot bound. Office reading uses zip and roxmltree without extracting files, resolving external entities, opening relationships or launching converters. A preflight rejects ZIP64/multi-disk archives and bounds the central directory before allocating the archive map. Limits are 512 entries, 512 KiB central directory, 8 MiB per part, 32 MiB declared expanded bytes, 150,000 XML nodes per part, 2 MiB interpreted text, 4,000 Word blocks and 20,000 table cells. Part reads independently cap actual decompression. XLSX additionally permits 32 sheets, 5,000 rows and 128 columns; coordinates and duplicate cells are checked. Worksheet relationships stay within fixed `xl/worksheets/*.xml` archive parts and external relationships are rejected. Shared strings, inline text, booleans, error values and cached formulas are presented as text. Formula evaluation, links, macros and scripts are unavailable. CSV accepts bounded UTF-8/BOM text with quoted fields and comma/semicolon delimiters. Legacy DOC/XLS show a conversion notice.

`DocumentReader`, `SheetReader` and `PdfReader` render in the existing right dock, retaining its resize/maximize controls. At most eight transient document tabs are keyed by native owner/ID and a separate visible draft/session scope. Opening a chip does not create a session. A first-send transition moves the visible tab scope while retaining the original native owner. Navigation hides foreign scopes; removing an unsent attachment or its metadata owner closes related tabs. A sent snapshot can remain in an already-open tab, but there is no durable transcript attachment reconstruction or restoration after restart.

Word paragraphs, heading outlines, lists and tables render through escaped React text; no document HTML is admitted. The readable view omits images and original Word pagination. Sheets virtualize 60 rows, provide keyboard cell navigation, worksheet selection and a read-only value/formula field. Values retain the saved representation; number/date styling, merged cells and charts are omitted.

PDF.js's legacy display/worker bundles load lazily for WebKit compatibility. Vite emits a fixed local set of CMaps and standard fonts; the same asset map is used by the development server. PDFs are supplied as bytes, with no document-selected network URL. Canvas glyph rendering disables dynamic font-face CSS; WASM is disabled. The existing CSP and capabilities remain unchanged. Only the active PDF page renders; page/zoom changes cancel previous rendering, and unmount terminates its worker. Load/render timeouts terminate the worker after 30 seconds. The reader limits PDFs to 1,000 pages, images/canvas to 12 million pixels and canvas edges to 8,192 pixels. Password-protected/damaged files fail visibly. A selectable page-text view provides access to extracted text; PDF forms, actions, scripting and interactive links are not mounted.

## Consequences

- **Positive:** selected documents can be read beside a draft or running conversation, using existing native snapshots and dock controls.
- **Negative:** Office layout is a content view rather than an Office editor; unusually large documents, legacy formats, protected PDFs and PDF codecs requiring WASM are unavailable.
- **Accepted trade-off:** retain bounded memory-only attachment lifetime instead of introducing durable binary transcript storage or cloud document services.

## Alternatives considered

- A second modal/full-screen reader: the selected dock design keeps conversation context visible and already supports maximization.
- Native Quick Look or arbitrary external converters: unavailable as a portable dock surface and would expand process/path authority.
- Rendering untrusted converted Office HTML: escaped typed blocks keep active markup and external resources out of the webview.

## References

- [PDF.js API](https://mozilla.github.io/pdf.js/api/) and [examples](https://mozilla.github.io/pdf.js/examples/).
- [zip archive reader](https://docs.rs/zip/latest/zip/read/struct.ZipArchive.html).
- [roxmltree parsing options](https://docs.rs/roxmltree/latest/roxmltree/struct.ParsingOptions.html).
