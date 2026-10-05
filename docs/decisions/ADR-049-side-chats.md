# ADR-049: Side chats beside a working session

**Status:** Accepted

## Context

While an agent works on a long turn, people want to ask about it ("why offset
instead of a cursor?") without interrupting it or adding noise to its
conversation. Sending into the main session queues the question (ADR-042) or
needs a Stop. A fork (ADR-016) or handoff (ADR-028) requires a settled source
and creates a normal session in the list.

Synara has side chats for this: `/side`, ⌘⌥S, a "Side chats" dock pane, an
Environment section and an "Ask" action in code review. Its side chats import a
forked history, inherit permissions and expire after an hour of inactivity.

## Decision

A **side chat** is a normal native `Session` with
`sideChat: { parentSessionId }`. Each main session has at most one.

| Property | Rule |
| --- | --- |
| Workspace | The parent's `worktree`, never a copy, so answers describe the real files. |
| Provider | Starts with the parent's provider, model and account. It can be changed before the first message, like any idle session. |
| Context | Every side-chat turn wraps the prompt with a fresh, bounded recap of the parent as it is at send time, built natively under the state lock. The recap holds the title, provider, status, workspace path, the last 3 user requests (600 characters each), the last finished answer (2,400) and the end of any in-progress output (1,600), within 6,000 characters in total. The persisted user message keeps the visible text. Native resume keeps the side chat's own history. |
| Permissions | Unchanged: the side chat uses its own composer's per-turn approval profile (ADR-017). A new side chat starts in planning mode (read-only) where the provider supports it. The person can turn that off. |
| Visibility | Hidden from the sidebar, tabs, Kanban, worktree list and all-conversations search. Selecting it (for example from a notification) selects the parent and shows the side chat. |
| Lifetime | Deleting the parent deletes its side chat. A running side chat blocks that deletion. A side chat can never remove the shared worktree. There is no expiry. Deleting an idle side chat (Environment row) and opening again starts fresh. |
| Flow back | Nothing returns to the parent automatically. "Take to main chat" quotes an answer into the parent's draft, and sending stays explicit. |

**Access:**

- ⌥⌘S (customizable, central registry) shows or hides the side chat and moves focus between the composers. Escape inside the side chat hides it and never stops the main agent.
- "Side chat" in the right-dock launcher and the "+" menu.
- An Environment row to open or delete it.
- "Ask in side chat" on assistant messages and on transcript text selections, which quotes the text into the side chat's draft.
- ⌘K.

A `/side` command is deferred.

### IPC security review

One command is added: `side_chat_action`. It is a closed enum with `deny_unknown_fields` and a single action, `open { parentSessionId }`, which returns the existing side chat or creates one.

The review:

- **Inputs:** only a session ID. No path, provider, model, prompt or flag is accepted. The worktree, provider, model and account are copied natively from the owned parent.
- **Parent checks:** the parent must exist and must not be a side chat. A disabled provider is refused.
- **Responses:** session metadata, as `load_state` returns it (ADR-048).
- **Native admission:** `send_prompt` builds the recap natively. A side chat cannot coordinate a team.
- **Deletion:** `delete_session` refuses `removeWorktree` for side chats and cascades from the parent.
- **No new surface:** no new process kind, capability, filesystem access or provider permission.

The recap carries only text the person already sees in the parent, and it goes to the same provider family the person chose.

## Consequences

- **Positive:**
  - Questions run in parallel with the main turn, against the real workspace, with live context and no transcript noise in the parent.
  - One side chat per session keeps the model and the UI simple.
- **Negative:**
  - Two agents can work in the same checkout at once. Planning mode is only the default, so a side chat whose planning is turned off can edit the same files as the parent.
  - The recap is a summary. Tool details and older answers are not included.
- **Accepted trade-off:** the recap is re-sent on every turn, about 6 KB at most. In exchange, the side chat always sees the parent's latest state without replay rules.

## Alternatives considered

- **Fork the history (Synara, ADR-016).** Rejected. A fork needs a settled source and copies stale history, while the question is usually about the turn still running.
- **Several side chats per session with an expiry lease (Synara).** Deferred. One side chat that can be deleted and reopened covered the need without lease bookkeeping.
- **Recap once at open (handoff style, ADR-028).** Rejected. The parent keeps working, so a recap from open time is stale by the second question.
- **Read-only side chats enforced natively.** Rejected. Planning is the default, and the person may want the side chat to make a small fix.
