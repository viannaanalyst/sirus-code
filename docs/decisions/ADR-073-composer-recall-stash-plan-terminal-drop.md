# ADR-073: Prompt recall, stash, plan actions, terminal snippets and Finder drops

**Status:** Accepted (2026-10-06). Ideas taken from T3 Code; the owner approved them from a preview.

## Decision

- **Prompt recall.** With an empty composer, ↑ walks this session's sent prompts (the request as written, without the reference block) and ↓ walks back; past the newest the draft returns (`recallStep`). Typing ends browsing. The suggestion menu keeps its own arrows.
- **Stash (⌘S).** ⌘S in the composer sets the draft aside; with an empty composer it brings back the only one, or opens the list when there are several. A bookmark with the count sits beside the add button and opens the list (restore or discard). Up to 20 per composer owner, kept in local storage, never sent.
- **Plan actions.** After a planning turn (the session's last execution had `planning`) settles with an answer, the transcript shows "Plano pronto" with **Implement** (sends "Implemente o plano acima." with planning switched off) and **Adjust plan** (focuses the composer); a banner above the composer offers Implement and ⌘↩ does it from an empty composer.
- **Terminal snippets.** Selecting text in the session terminal shows "Add to chat"; the selection (at most 16 KiB) becomes a Terminal chip in that session's composer (`ComposerContext.snippets`), travels in the reference block as "Terminal output" and shows as a Terminal chip on the sent message. Sending clears snippets like attachments.
- **Finder drops.** Files and folders dropped on the composer become attachments. The webview never receives Finder drags in a Tauri window with drag-and-drop disabled (verified: no `dragenter` arrives), and WebKit hides dropped paths anyway (T3 Code relies on Electron's `webUtils.getPathForFile`). So the window's native drag-and-drop is on (`dragDropEnabled: true`; the app's own reordering uses pointer events, not HTML5 drag): `WindowEvent::DragDrop` keeps the dropped paths natively and emits `file-drop` with only the position (`over`/`drop`/`leave`); the composer under the pointer shows a drop overlay and on `drop` calls `drop_prompt_attachments`, which takes the stored paths once and only within 5 s (at most 8), preparing them like picked attachments. The renderer never supplies a path.

## Consequences

- The stash lives per machine (local storage), not in session files.
- A drop is only read when the composer receives it; a later call for the same drag returns nothing.
