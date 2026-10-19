# ADR-148: A Pull button in the window header when the branch is behind

**Status:** Accepted (2026-10-19).

## Context

The Changes pane shows ↑ahead ↓behind from `git status`, but only against what was last fetched, and pulling meant opening the Environment card's Commit & Push row. The automatic pull (ADR-130) only covers a clean project checkout on the default branch and is off by default. The person should see, from any conversation, when its branch can simply be fast-forwarded, what is coming, and pull with one click.

## Decision

- **Native state** (`git_incoming.rs`). `git_incoming { sessionId }` answers for the conversation's workspace (its worktree or the project checkout): `{ branch, upstream, ahead, behind, commits[≤20] { sha, subject, author, time }, checkedAt }`, or null on a detached HEAD, without an upstream, or when the upstream is not on a remote (remote `.`). Counts come from `rev-list --left-right --count HEAD...<tracking ref>`, commits from `log -n 20 HEAD..<tracking ref>`.
- **Background fetch.** Before answering it may fetch only that branch: `git fetch --quiet --no-tags --no-write-fetch-head <remote> +refs/heads/<b>:<tracking ref>` (`git::fetch_branch`, 15 s bound, the hook and project network-helper refusals of push and pull, ADR-130), inside `process_priority::background` (ADR-143). A per-repository-and-upstream mark (keyed by the absolute common Git dir, so worktrees of one repository share it) allows one fetch per 15 s after a success and backs off 30 s → 60 s → … → 5 min after failures; a fetch already running is not repeated. A failed fetch still answers from the local remote-tracking ref.
- **When it is asked.** The header asks when the selected conversation or its folder changes, when the window regains focus or becomes visible, when the conversation's turn settles (working → not working), and every 5 minutes while the window is visible. With the 15 s mark, the network is touched at most four times a minute per repository, and in practice about every 5 minutes plus on returning to the window.
- **Pull** (`git_pull_ff { sessionId }`): `git pull --ff-only --no-rebase --no-edit --no-stat <remote> <branch>` at the person's normal priority, 30 s bound, same refusals. Refused while a conversation works in that workspace (the same folder, or any conversation of the project that is not in its own worktree when pulling the checkout). Git's "would be overwritten by" lists become `{ status: "blocked", files }` (nothing changed); "Not possible to fast-forward" becomes `{ status: "diverged", incoming }`; success is `{ status: "pulled", incoming }`, after which the window refreshes Git status and the project totals.
- **The button** (`GitIncomingButton`, session view, desktop and paired devices). Shown only when `behind > 0 && ahead == 0`: an icon-only cloud-download button with the update pill's soft blue, tooltip "Pull 3 commits from origin/main". It opens a popover (bottom, end): "3 new commits on origin/main", "You are on main · no local commits", the commits (mono short hash, subject, author · age) and Pull now. Pulling shows a spinner and "Pulling…"; success turns the icon green with a check ("main is up to date with origin/main") for 3 s, then it leaves; blocking files and other errors show in a red box in the popover. Diverged (`ahead > 0 && behind > 0`) shows the icon muted, without a popover, with "main diverged from origin/main (3 there, 1 here). Ask the agent to integrate."; otherwise nothing is shown. It enters and leaves with the header's motion and respects reduced motion.

## Consequences

- The button appears without the person opening anything, at the cost of a small background fetch per repository about every 5 minutes while the window is visible.
- It never merges or rebases; divergence is left to the agent or the person.
- The older Environment card Pull (origin only, no timeout) and the automatic pull keep working; the automatic pull's fetch now goes through the same `fetch_branch` and no longer writes `FETCH_HEAD`.
