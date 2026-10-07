# ADR-086: Phone app features from T3 Code

**Status:** Accepted

## Context

Compared with T3 Code's mobile app, the phone app (ADR-081/084) lacked these things a person needs while away from the Mac:
- alerts that say what happened;
- photos;
- quick list actions;
- messages written without a connection;
- branch and PR;
- diff comments;
- provider usage;
- a file browser.

All of these are possible in an iPhone home-screen web app; Live Activities, widgets and haptics are not, and are left out.

## Decision

1. **Alerts by kind.** A turn that fails now raises a `failure` alert ("A tarefa falhou"). It follows the completion switch and sound, and shows red on the Mac. The phone's push adds a line under the project and conversation: the command or number of files awaiting approval, the question asked, the first line of the final answer, or the error (`notifications::detail`, bounded to 140 characters).
2. **Photos and files.** On a phone the composer's + offers "Photo or file" and "Camera" through the browser's picker. Photos are scaled on the device to at most 2048 px as JPEG 0.85 (`lib/phone-attachments.ts`) and sent through `paste_prompt_attachments` with their bytes. Remotely, that command is accepted only with files: with none it would read the Mac's pasteboard.
3. **Swipe actions.** Conversation rows slide left (`MobileSwipeRow`, horizontal drags only, so lists still scroll):
   - in lists: Pin, Archive and Delete;
   - among archived conversations (a link at the end of Home): Restore and Delete.
   Pinned conversations get their own Home group after those needing the person. Delete uses `MobileDeleteDialog`, which follows the Mac's rules.
4. **Offline queue.** A message sent while the Mac is out of reach (`remoteReachable()`) waits in the phone's storage (`lib/phone-outbox.ts`, text only, at most 50). The conversation shows it with a cancel button, and it goes out in order once the socket reconnects. A failure stops the rest from going out behind it. The transport's own "out of reach" errors no longer raise toasts on the phone.
5. **Branch and pull request** (conversation ⋯ menu):
   - the current branch with ahead/behind counts;
   - search, switch and create branches for the project checkout (isolated worktrees keep their branch), each confirmed;
   - the PR's number, title, state and checks, with a link that opens on the phone.
6. **Diff comments.** In the phone review, a line or range of a diff can be commented (`ChangesPane` gains `onComment`). The comment joins the conversation's draft through `appendDiffComment`, with a "Send" shortcut back to the conversation.
7. **Usage and limits.** Phone Settings shows each installed provider's windows as bars, with their reset times and refresh.
8. **Files** (conversation ⋯ menu). It browses the session's workspace, folders first, and previews files read-only: text and code as monospace, Markdown formatted, images through `reply_image`.

Phone layout fixes:
- Compact and send keeps only its icon.
- The review gives the history a short scrolling band, so the diff and its comment box stay visible.
- A turn's change summary wraps its actions onto their own line on small screens (iPhone SE).

## Consequences

- Pin, archive and delete from the phone change the same settings as on the Mac.
- Queued messages carry no attachments, and they are sent with the execution options chosen when they were written.
- A queued message cancelled on the phone never reaches the Mac.
