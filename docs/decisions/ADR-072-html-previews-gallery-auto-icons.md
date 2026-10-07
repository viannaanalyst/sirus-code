# ADR-072: HTML in the transcript, reply image gallery and automatic project icons

**Status:** Accepted (2026-10-06). Ideas taken from T3 Code at the owner's request.

## Context

The owner asked for three T3 Code features: an agent's HTML shown working inside the conversation, images in replies opening as a gallery, and projects showing their own favicon or logo (as an option, off by default, toggled in Settings).

The app's CSP (`script-src 'self'`) is inherited by `srcdoc`, `blob:` and `data:` frames, so an inline frame could only show static HTML; agent previews usually rely on inline scripts.

## Decision

- **HTML in the transcript (`html_preview.rs`, `HtmlPreview`).** A settled reply's ```html block renders as a page with a Page/Code toggle. The frontend registers the source with `html_preview` (bounded to 2 MiB, at most 48 pages in memory, keyed by a content hash; nothing is written to disk) and loads `sirus-preview://localhost/<id>` in an iframe sandboxed with `allow-scripts allow-forms allow-modals` (no same-origin). The custom scheme serves the page with its own CSP: inline scripts and styles allowed, no `connect-src`, images and fonts only from `data:`, `blob:` and `https:`. A small injected script posts the page height so the frame fits (80–720 px). The app CSP adds only `frame-src sirus-preview:`. The page has an opaque origin and no Tauri IPC.
- **Reply image gallery.** Markdown images `![alt](url)` render for `https:` and `data:image/(png|jpeg|gif|webp)` URLs as bounded thumbnails; other schemes and local paths stay links. Clicking opens one app-wide gallery (`ImageGalleryHost`, `GALLERY_EVENT`) with the message's images: arrows and ←/→ move, Escape, a backdrop click or × close. Sent attachment thumbnails use the same viewer.
- **Automatic project icons (`project_auto_icon`).** Off by default (Settings → General → Automatic project icons). When on, a project without a chosen logo, emoji or Astro icon shows its own icon: the first of a fixed list of candidate paths inside the project (`public/favicon.svg`, `app/icon.png`, `favicon.ico`, `logo.svg`, `src-tauri/icons/128x128.png`, …), at most 512 KiB, never through a symlink leaving the project. SVG is used as an `<img>` data URL (scripts never run there); PNG, JPEG and ICO become the same 96 px PNG as a picked logo. The lookup runs once per project while the app runs.

## Consequences

- An agent's HTML can run JavaScript in the transcript, isolated from the app; it cannot fetch from the network.
- Local image paths in replies are not shown as images yet (the renderer has no local file reads).
- The `image` crate gains its `ico` decoder.
