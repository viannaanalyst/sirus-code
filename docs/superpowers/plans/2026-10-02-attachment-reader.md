# Attachment Reader Implementation Plan

> **For agentic workers:** Use the executing-plans workflow inline; the owner has approved the side-panel design and implementation. This checkout has no Git metadata, so branch creation and commits are unavailable.

**Goal:** Open admitted PDF, DOCX, XLSX and CSV attachments in the existing resizable, maximizable right dock.

**Architecture:** A read-only owner/opaque-ID command resolves private native snapshots. Bounded native Office/CSV parsers return typed text and cells; PDF bytes feed a bundled local PDF.js worker. Reader tabs are transient and owner-scoped, including project drafts before a session exists.

**Tech Stack:** Rust zip/roxmltree/csv, React 19, PDF.js, existing Client/Transport/Zustand/dock.

## Global Constraints

- No renderer filesystem paths, frontend filesystem/shell permissions, converters, macros or formula execution.
- Native ownership is checked before reading and again before returning; source files remain untouched.
- Existing attachment limits and lifetime apply; previews are never persisted.
- Office preview presents readable content, not a page-perfect Word/Excel editor. Legacy .doc/.xls are explicitly unsupported.

### Task 1: Native preview boundary and parsers

Files: `src-tauri/src/document_preview.rs`, `attachments.rs`, `lib.rs`, `Cargo.toml`.

- [x] Add fixture tests for paragraphs/tables, sparse/shared-string sheets, cached formulas, CSV quoting, malformed ZIP/XML, decompression and dimension bounds, foreign/removed owners.
- [x] Implement `attachment_preview(owner, id) -> DocumentPreview` with a single bounded in-flight parse, private snapshot reads and post-read owner/ID validation.
- [x] Run targeted native tests, check and clippy.

### Task 2: Client and dock reader

Files: `src/client/types.ts`, `index.ts`, `src/store/app-store.ts`, `src/components/DocumentReader.tsx`, `PdfReader.tsx`, `RightDock.tsx`, `ComposerAddMenu.tsx`, `src/lib/document-reader.ts`, `src/i18n/document-strings.ts`.

- [x] Add discriminated PDF/Word/sheet response types and Client method.
- [x] Add bounded document tabs keyed by native owner/attachment ID, with separate visible draft/session scope and owner pruning.
- [x] Make supported chips open the dock; support landing, loading/error/retry, safe text-only Word rendering, sheet tabs/cell/formula selection and PDF page/zoom/text access.
- [x] Add tests for scope/lifetime, supported types, grid references and Client payloads; run typecheck/lint/test/build.

### Task 3: Security review and delivery

Files: `docs/decisions/ADR-039-attachment-document-reader.md`, ADR index, `AGENTS.md`, Graphify outputs.

- [x] Review bounds, owner races, worker cancellation, local PDF assets/CSP and absence of active Office content.
- [x] Run native fmt/check/clippy/test and frontend verification, then update Graphify incrementally.
- [x] Report supported formats and meaningful rendering/lifetime limitations.

## Verification evidence

TypeScript, ESLint, 164 Node tests and all SSR fixtures (including reader scope/transfer/removal, escaped Office content and an actual two-page PDF raster/text check) passed. All 100 Arc previews passed. Native format/check/clippy and the full Rust suite passed; live provider tests remain intentionally ignored. A signed local macOS app bundle was generated. Graphify was updated incrementally; its known partial extraction of the large store remains, while TypeScript checks pass. Native UI inspection was attempted, but the picker interaction was interrupted before a document could be inspected; the new reader has automated, not end-to-end visual, verification.
