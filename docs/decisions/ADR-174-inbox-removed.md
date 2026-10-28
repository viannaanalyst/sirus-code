# ADR-174: Inbox removed

**Status:** Accepted (2026-10-28). Supersedes the Inbox part of ADR-052; the customizable rail it also introduced stays.

## Context

ADR-052 added an Inbox page: one list, derived from live session state, of what needs attention
across projects (waiting, running, ready to review, failed) plus a row for pull request review
requests. The sidebar already shows the same status on every conversation row, with unread and
waiting markers, and the Pull requests page (ADR-050) lists review requests. The owner decided
the Inbox duplicated both and removed it, after Tasks (ADR-172) and archiving (ADR-173) went the
same way.

## Decision

Remove the Inbox page and everything that existed only for it.

- The page, its styles, its grouping helper, the `inbox` rail item, the `inbox` main view, the
  command palette entry, the page title branch, the sidebar and settings-preview rows, the
  "needs you" dot on the rail and every `inbox.*` string are gone.
- The rail's closed set is now `home` and `pulls` (`RAIL_ITEMS` in `models.rs` and
  `src/lib/rail.ts`). Saved settings that still list `inbox` in the rail order or hidden items
  load without error and drop it on normalize, as `tasks` did.
- Kept because the Pull requests page uses them: the GitHub review inbox (ADR-050:
  `githubInbox`, `loadGithubInbox`, `github_inbox.rs`, `review-inbox.css`), the unread pull
  request dot, `activity.markAllRead`, and the unseen-session list that drives unread markers.
  The phone app's Home list (ADR-081) is a separate screen and is unchanged.

ADR-052 stays as history, marked as superseded for the Inbox.

## Consequences

- There is no single cross-project "needs you" page. Waiting and unread conversations are found
  in the conversation list; review requests are on the Pull requests page.
- The rail has one customizable position fewer than before: Home and Pull requests remain.
- No data migration is needed: the Inbox stored nothing.
