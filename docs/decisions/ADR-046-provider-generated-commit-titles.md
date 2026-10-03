# ADR-046: Provider-generated titles from the prepared index

**Status:** Accepted

## Context

A filename suggestion cannot describe the meaning of prepared edits. An explicit
provider request can, but must not create a conversation, edit the checkout, or
silently switch the person's provider account.

## Decision

`commit_title.rs` owns a closed `commit_title_action` with Generate and Cancel.
Generate accepts session ID, expected index token and UUID request ID only; Cancel
accepts the matching owner/request. Unknown fields fail. Responses contain only a
printable single-line English title (at most 72 Unicode characters), Codex/Claude
provider ID and an excerpt indicator, or cancellation. No new persistence,
capabilities, renderer process authority or transcript entries are introduced.

Native capture reuses the whole-index staged Commit guard: empty, stale,
conflicted, incomplete, linked/submodule and outside-workspace sets fail. Fixed
Git argv disable external diff/textconv and read the index against HEAD (including
unborn HEAD), never unstaged content. Filenames are excerpted at 8 KiB and patch
at 40 KiB on UTF-8 boundaries; `partial` identifies excerpts. Git's existing
bounded probe ceiling can refuse extremely large diffs rather than infer from an
unbounded stream. Ownership, provider selection, account scope, executable file
identity and expected index are checked again before inference and publication.
External Git/configuration/credential replacement races remain admission limits.

Selection prefers the session provider when it is enabled and installed, then
Codex and Claude. The same-provider session profile, retained cross-provider
binding, or selected native profile is used, in that order. Missing named profiles
and login-in-progress fail without account/provider retry. Authentication stays
in the vendor CLI with the existing child-only account environment.

A process-wide utility reservation precedes context capture. Fixed stdin prompts
quote only prepared data as untrusted JSON. Codex runs ephemeral JSON exec with
ignored user config/rules, read-only sandbox, shell/unified execution/apps disabled,
web search disabled and project documentation loading disabled. Claude runs print
JSON with safe mode, empty built-in tools, denied MCP tools, strict empty MCP
configuration, empty setting sources, disabled slash commands, no session
persistence and planning permissions. Both use a private 0700 empty temporary
working directory. CLI defaults choose the model. Managed vendor policy may still
apply, especially Claude admin policy; this is not an OS isolation claim.

Stdin/stdout/stderr are concurrently bounded, with a 90-second child deadline.
Only successful process exits and structured successful final provider messages
are accepted. Tool/error events, malformed replies and invalid titles fail with
fixed errors; stderr, reasoning and provider envelopes never cross IPC or logs.
Owner/request cancellation, shutdown and dropped futures stop the owned process
group. The leader stays unreaped while pipes drain; reaping and publication of
its PID removal share the shutdown mutex, preventing signals to reused PIDs.
Pre-registration cancellations are remembered in a bounded 90-second owner list.

## Consequences

Generation sends prepared code to the chosen provider only when explicitly
requested; it never stages, commits or pushes. The UI remains responsible for
preserving edits made during generation and rejecting obsolete view results.
One utility runs at a time; no automatic inference fallback exists. Unsupported
installations receive an explicit Codex-or-Claude requirement and manual titles
remain usable.

Local help and disposable synthetic prompts verified these installed CLI flags:
both returned successful final JSON with no repository context or stderr. This
verifies adapter invocation, not the complete desktop integration. Native fixtures
exercise staged-byte capture, strict replies and bounded process lifecycle.

## Alternatives considered

Using an ordinary chat turn would mix transcript/account lifecycle with an
editing convenience. Passing renderer diff/prompt/argv would expand the untrusted
webview's authority. Automatic provider retries could spend money on another
account. Local metadata-only titles remain manually editable but cannot infer
meaning; the Changes title flow follows this explicit request instead.

This extends [ADR-045](ADR-045-explicit-git-index-workflow.md) and preserves the
account ownership rules of [ADR-015](ADR-015-isolated-provider-accounts.md).
