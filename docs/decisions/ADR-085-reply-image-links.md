# ADR-085: Image links in replies

**Status:** Accepted

## Context

Agents often answer with links to images they saved on the Mac, such as `[see image](/tmp/previews/a.png)`, for previews, charts and screenshots. The transcript renders web links and workspace files as links. A path outside the workspace stayed plain underlined text, and the webview cannot load a local path on its own.

## Decision

- `isLocalImageLink` (`lib/chat-markdown.ts`) recognises links to `.png`, `.jpg`/`.jpeg`, `.gif` or `.webp` files. The link can be absolute, relative, `~/` or `file:///`. Web links and other schemes are not matched.
- The transcript renders such links with an image icon. A tap reads every image link of that message through `reply_image(sessionId, path)` and opens them together in the existing image gallery, starting at the one tapped.
- `reply_image.rs` resolves relative paths in the session's workspace, `~/` in the home folder, and strips `file://`.
- It accepts only those extensions, a regular file of at most 25 MiB, and bytes that start like PNG, JPEG, GIF or WebP. It returns a data URL and writes nothing.
- The command works from paired devices too, so the phone opens the same images.

## Consequences

- A reply can show the person any image file on the Mac it names. This needs the person's tap, the extension and byte checks keep it to images, and nothing leaves the Mac except to the person's own paired devices.
- SVG is excluded: it can carry script.
