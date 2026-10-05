# ADR-058: Mermaid diagrams

**Status:** Accepted

## Context

Agents often explain architecture with fenced `mermaid` blocks, which rendered as raw text. The owner asked for diagrams in the transcript and the Markdown preview.

## Decision

**Rendering.** A completed ` ```mermaid ` block renders as a diagram (`MermaidDiagram`), with a toggle back to the source. Blocks that are still streaming, are in search results or exceed 20,000 characters stay code blocks, as does anything Mermaid fails to draw.

**Dependency.** `mermaid` (^12) is a new dependency. It is loaded with a dynamic import on first use, so it is not in the startup chunk.

**Security.**

- **Untrusted input:** the source comes from agent output and is treated as untrusted. Mermaid runs with `securityLevel: "strict"` and `htmlLabels: false`, which sanitizes labels and drops click handlers; errors are not rendered by Mermaid itself.
- **CSP:** the returned SVG is parsed with `DOMParser`. Its `<style>` elements receive the page's existing nonce before insertion, so CSP is not relaxed.

## Consequences

- **Positive:** diagrams read as drawings in conversations and Markdown files.
- **Negative:** the first diagram downloads a large chunk.

## Alternatives considered

- **Streamdown's Mermaid plugin (MonoCode).** Rejected: our Markdown renderer is our own.
- **Allowing `unsafe-inline` styles.** Rejected: CSP stays as it is.
