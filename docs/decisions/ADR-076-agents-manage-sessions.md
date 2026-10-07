# ADR-076: Agents manage sessions

**Status:** Accepted

## Context

Astros can already list, start, read and message sessions in their projects (ADR-069). MonoCode's opt-in app CLI (PR #423) gives every agent similar control. The owner asked for the same in every session, off by default.

## Decision

- **Tools.** The per-session MCP bridge (ADR-030) gains `sirus_list_sessions`, `sirus_read_session`, `sirus_session_status`, `sirus_create_session` and `sirus_send_to_session`, available to Codex, Claude and OpenCode sessions.
- **Switch.** Settings → MCP servers → "Let agents manage sessions" (`agentsManageSessions`, default off). While it is on, adapters pass `SIRUS_SESSION_TOOLS=1` to the `--mcp-browser` child, which then lists the tools; every call also rechecks the setting, so turning it off stops them at once. A running Codex app-server keeps its tool list until it restarts.
- **What agents can do.** List projects and sessions (≤40, newest first, the caller marked `self`); read a session's status and its last messages (1–20, user and assistant text only, ≤2,000 characters each); start a normal, visible session in any project with a prompt (≤32,000 characters), an optional title, provider, model and worktree choice; send a message to another idle session.
- **Safeguards, reused from Astro delegation.** Starts and messages go through the same `astros::start_from` / `send_from` code: the new turn carries the caller's approval mode, so with Ask it waits for the person in its own tab, and Full stays Full only when the caller already is. A caller in planning (read-only) is refused. A session cannot message itself or a session that is still working. One caller turn may start 4 sessions and send 8 messages, and sessions started by agents may start sessions only one more level down (depth 2). The counters are memory-only and reset with the app.
- **What agents cannot do.** Delete, archive, rename or stop sessions; answer approvals or questions; change settings, projects or Astros; see Astro conversations or side chats. Results do not come back automatically as they do for Astros: the caller checks with `sirus_session_status`.

## Consequences

- **Positive:** any agent can split work into sessions or follow up on another one, with the same approvals the person already chose.
- **Negative:** with the switch on, a Full-access session can start more Full-access work without a new prompt; the switch is off by default and the limits bound the fan-out. Depth and per-turn counters do not survive a restart.

## Alternatives considered

- **A separate `sirus` MCP server.** Rejected: one more child process and config entry per provider, when the existing bridge already authenticates each session.
- **Always listing the tools and refusing calls when off.** Rejected: it adds five tools to every session that cannot use them.
