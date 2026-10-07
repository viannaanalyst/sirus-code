# ADR-088: Astro documents, launched sessions, permissions and the menu bar

**Status:** Accepted

## Context

MonoCode's Monos (the model for Astros, ADR-069) gained five features in October 2026:
- lasting documents;
- a Sessions control on replies;
- a permission mode per Mono;
- hiding the sessions a Mono starts;
- a menu bar item with a floating chat.

Astros had none of these:
- Their work products lived only inside reply text.
- Sessions they started left no trace on the reply.
- Their conversations always started in Ask.
- Delegated sessions crowded the sidebar.
- There was no way to talk to an Astro without opening the main window.

## Decision

1. **Documents.**
   - `astro_documents_list`, `astro_document_read` and `astro_document_write` save Markdown reports and plans.
   - Each document is one JSON file in `documents/` next to `state.json`. The limits are 200 per Astro, a 120-character title and 100,000 characters of Markdown, and ids are UUIDs checked before any path is built.
   - A write lists the document on the running reply (`Message.documents`), which shows it as a card. The card opens a reader with formatting, Copy and Delete.
   - A creation retried in the same reply, with the same title, revises the saved document instead of duplicating it.
   - Deleting a document removes its cards from every saved reply, so a later save cannot restore them.
   - Open readers refresh on `astro-document-changed`.
   - Deleting an Astro removes its documents.
2. **Launched sessions.**
   - Sessions an Astro starts are recorded on the running reply (`Message.launched`) and marked `Session.launchedBy { astroId, hidden }`. This covers `astro_session_start` and, from an Astro, `sirus_create_session`.
   - The reply shows a "Sessions · N" control. It lists each session with provider, model, project, branch and status, and opens it.
3. **Permissions.**
   - `Astro.approval` (Ask, Auto or Full) is chosen in the drawer and defaults to Auto, including for Astros saved before this change.
   - A new conversation starts in that mode, and the composer of an Astro conversation falls back to it.
   - The automatic "sessions finished" turn now uses it too; before, it reset the mode to unset.
4. **Hidden sessions.** `Astro.hideSessions` keeps the sessions the Astro starts from then on out of the sidebar and lists (`launchedBy.hidden`). They stay saved and open from the reply's Sessions control.
5. **Menu bar.**
   - A tray item with the Sirus logo (a template image, so it follows the menu bar) lists "Astros", each Astro with a dot in its colour, then "Open SirusCode" and "Quit SirusCode". Quit takes the same path as ⌘Q.
   - Choosing an Astro opens `astro-float`: a resizable window that stays above other windows and follows across Spaces. It runs the normal UI over the same state, showing only that Astro's conversation (`AstroFloat`), so messages, attachments, approvals, questions and stop all work there.
   - "Open in Sirus Code" shows the conversation in the main window.
   - The float closes when the main window closes. Its close never runs the app quit flow.
   - Opening the float and showing the main window are refused to paired phones.

## Consequences

- Documents and launch records survive restarts. A launch record points to a session id, and a session that was deleted shows as gone.
- The float window has its own store, kept in sync by the same native events as the main window. It never writes layout or tabs.
- `tauri` now builds with `tray-icon` and `image-png`.
