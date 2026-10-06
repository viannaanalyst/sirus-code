# ADR-050: Review inbox for pull requests and issues

**Status:** Accepted

## Context

[ADR-031](ADR-031-read-only-pull-request-checks.md) shows one read-only PR card per session branch. The owner asked for a full review page "like Synara": every PR and issue of their projects, with filters, details, diffs and the usual GitHub actions.

Synara's Code review page:

- **Data:** reads every added project's repositories through `gh api graphql` and polls every 5 minutes.
- **List:** sections Pinned, Authored by me, Needs my review, Involving me and Everything else, with status, involvement, project and label filters, and a search that accepts a pasted PR link.
- **Detail:** Summary, Timeline and Code tabs.
- **GitHub actions:** merge (merge, squash or rebase), draft ↔ ready, close/reopen and comment.
- **Agent actions:** "Send to agent", "Fix findings" and "Resolve conflicts" prepare a branch and open a draft thread.

## Decision

A **Pull requests** page, opened from the rail or ⌘K, lists items from the GitHub `origin` remote of every saved project. At most 24 repositories are read, 50 items per repository per list.

One closed command is added, `pull_request_action`:

| Action | Effect |
| --- | --- |
| `list { kind, state }` | Fixed GraphQL search per repository. The search text is built natively. |
| `detail { repository, number, kind }` | Fixed GraphQL query: body, checks, reviews, comments, commits, files and allowed merge methods. |
| `diff { repository, number }` | REST diff, bounded to 2 MiB. |
| `merge { …, method, expectedHead, confirm }` | `PUT …/merge` with `sha`, so GitHub refuses the merge if the head moved after the person looked. |
| `setDraft { …, draft, confirm }` | Ready-for-review or convert-to-draft mutation, by the node ID read natively. |
| `setOpen { …, kind, open, confirm }` | Close or reopen a PR or issue. |
| `comment { …, body, confirm }` | Issue comment, 1–65,536 bytes. |

**Security review:**

- **Repository:** the repository must be one derived natively from a saved project. Numbers are bounded. Renderer input never names an endpoint, query, flag, header, host or URL.
- **`gh` process:** every call reuses the hardened `gh` from ADR-031: `--hostname github.com`, no prompts, pager, browser, proxy, debug or host/repo overrides, run outside any repository, with bounded output and a timeout.
- **Values:** string values go through `-f`, never `-F`, so `@file` is never expanded.
- **Output:** text is control-stripped and bounded, and links must be `https://github.com/<same repo>/…`. Raw `gh` output never crosses IPC; refusals map to short fixed messages.
- **Confirmation:** changes require `confirm: true`. The renderer asks for confirmation before merge, draft/ready and close/reopen. For a comment, the explicit Comment click is the confirmation.
- **No new surface:** no token storage, app login, local Git mutation, fetch or capability.

**No polling.** Lists load when the page opens, when the window becomes visible and on Refresh. Pins persist as bounded `AppSettings.githubPins` (`owner/repo#n`, at most 200, validated natively). Filters are view state.

**Agent actions.** "Send to agent", "Fix findings" and "Resolve conflicts" open a new thread in the owning project with a draft holding the item's context: link, branches, body, failing checks and requested changes. Nothing is sent automatically. Unlike Synara, the PR branch is not fetched or checked out, because automatic fetch stays unavailable (AGENTS.md § Security).

This ADR amends ADR-031's "no GitHub mutations": the inbox may change GitHub only through the four confirmed actions above.

The same change adds the sidebar **Activity view**, a notebook toggle beside search persisted as `sidebarActivityView`. It groups listed sessions as Pinned, Needs you, Working, then Today, Yesterday and Earlier, with a scope menu and "Mark all as read".

*Amended:* the project grouping was removed at the owner's request, and rows now follow Synara: title, then project folder and branch, with hover Pin, Archive and Done.

- **Done:** moves a session into a collapsed Done section at the end, dimmed, with Undo.
- **Storage:** `AppSettings.doneSessions` holds the session ID and the time it was marked. It is bounded to 4096 entries and natively pruned with sessions, like archives.
- **Reopening:** a session leaves Done by itself when its `lastActivityAt` is newer than the mark, which happens after a send, agent output, Stop, rename or model change.
- **What it does not change:** execution, threads or worktrees.

*Amended:* **Fix all failures.** For an open PR with failing checks, the Checks block offers Fix all failures, and the menu keeps Fix findings. Both draft one prompt covering **every** failing check, with no picking. The closed, read-only `failures` action takes only an owned repository and number:

- **What is read:** a fixed GraphQL query lists the failing check runs and status contexts of the latest commit, with each check's title/summary/description and up to 10 annotations (`path:line message`).
- **Logs:** for GitHub Actions runs, a fixed GET `/repos/{repo}/actions/jobs/{id}/logs` returns the job log. The job ID is the check run's numeric database ID. The log is cut down natively to the lines around error markers plus its end, without timestamps or colour codes.
- **Bounds:** 10 checks, 4,000 bytes per log, 32,000 bytes in total. A log above the 2 MiB capture ceiling is left out.
- **Draft:** logs are fenced and labelled as data, not instructions. The draft asks the agent to say when a failure is not caused by the code (an external service, a flaky test, a deploy). If the lookup fails, the draft falls back to the check names. Nothing is sent automatically.

- **Positive:**
  - One place to triage and act on PRs and issues across projects, using the person's existing `gh` login.
  - Merges cannot land a head the person did not review.
- **Negative:**
  - Changes on GitHub are now possible from the app, limited to merge, draft/ready, close/reopen and comment.
  - Lists are only as fresh as the last load, because nothing polls.
  - Agent actions start from the project checkout, not the PR branch.
- **Accepted trade-off:** a 2 MiB diff ceiling and the 50-item, 24-repository bounds, in exchange for predictable cost.

## Alternatives considered

- **Polling like Synara (5 min / 2 min).** Rejected by the no-polling rule.
- **Preparing the PR branch in a worktree for agent actions.** Deferred until fetch is config-isolated.
- **Free-form `gh api` passthrough.** Rejected: there is no `execute_any_command`.
- **Including fork upstreams and `involves:@me` searches across all of GitHub.** Deferred. Only repositories of saved projects are read.
