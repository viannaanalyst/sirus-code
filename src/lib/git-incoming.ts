import type { GitIncoming, GitPullOutcome, IncomingCommit } from "@/client/types";
import { relativeTime } from "./session-board";

/**
 * The header's Pull button (ADR-148): what the selected conversation's workspace branch can
 * pull from its upstream. Native fetches in the background at most every 15 s per upstream;
 * the window asks on focus, when the workspace changes, after a turn settles and on this timer.
 */
export const INCOMING_REFRESH_MS = 5 * 60_000;
/** The green check after a pull stays this long, then the button leaves. */
export const PULLED_FOR_MS = 3_000;

export type IncomingButton =
  | { kind: "hidden" }
  /** Fast-forward possible: nothing local, something new. */
  | { kind: "pull"; count: number; branch: string; upstream: string }
  /** Both sides have commits: shown muted, no pull. */
  | { kind: "diverged"; ahead: number; behind: number; branch: string; upstream: string };

export function incomingButton(incoming: GitIncoming | null | undefined): IncomingButton {
  if (!incoming || incoming.behind <= 0) return { kind: "hidden" };
  const { branch, upstream } = incoming;
  if (incoming.ahead > 0) return { kind: "diverged", ahead: incoming.ahead, behind: incoming.behind, branch, upstream };
  return { kind: "pull", count: incoming.behind, branch, upstream };
}

/** A pull's answer as the popover shows it. */
export type PullFeedback =
  | { kind: "pulled" }
  | { kind: "blocked"; files: string[] }
  | { kind: "diverged"; ahead: number; behind: number };

export function pullFeedback(outcome: GitPullOutcome): PullFeedback {
  if (outcome.status === "blocked") return { kind: "blocked", files: outcome.files };
  if (outcome.status === "diverged") return { kind: "diverged", ahead: outcome.incoming?.ahead ?? 0, behind: outcome.incoming?.behind ?? 0 };
  return { kind: "pulled" };
}

const ACTIVE = new Set(["starting", "running", "waiting"]);

/** A turn just settled: the conversation went from working to not working. */
export function turnSettled(previous: string | undefined, next: string | undefined): boolean {
  return !!previous && !!next && ACTIVE.has(previous) && !ACTIVE.has(next);
}

/** "5m", "2h"…; "now" under a minute. */
export function commitAge(commit: IncomingCommit, now = Date.now()): string {
  return relativeTime(new Date(commit.time * 1000).toISOString(), now);
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

function readCommit(value: unknown): IncomingCommit | null {
  if (!isRecord(value)) return null;
  const { sha, subject, author, time } = value;
  if (typeof sha !== "string" || !/^[0-9a-f]{4,64}$/i.test(sha) || typeof subject !== "string" || typeof author !== "string" || typeof time !== "number" || !Number.isFinite(time)) return null;
  return { sha, subject: subject.slice(0, 200), author: author.slice(0, 80), time };
}

/** Validates `git_incoming`'s answer; anything unexpected reads as nothing to show. */
export function readIncoming(value: unknown): GitIncoming | null {
  if (!isRecord(value)) return null;
  const { branch, upstream, ahead, behind, commits, checkedAt } = value;
  if (typeof branch !== "string" || !branch || typeof upstream !== "string" || !upstream || !isCount(ahead) || !isCount(behind) || !Array.isArray(commits)) return null;
  return {
    branch, upstream, ahead, behind,
    commits: commits.slice(0, 20).map(readCommit).filter((commit): commit is IncomingCommit => !!commit),
    checkedAt: typeof checkedAt === "number" && Number.isFinite(checkedAt) ? checkedAt : null,
  };
}

/** Validates `git_pull_ff`'s answer. */
export function readPullOutcome(value: unknown): GitPullOutcome | null {
  if (!isRecord(value)) return null;
  if (value.status === "pulled" || value.status === "diverged") return { status: value.status, incoming: readIncoming(value.incoming) };
  if (value.status === "blocked" && Array.isArray(value.files)) return { status: "blocked", files: value.files.filter((file): file is string => typeof file === "string" && !!file).slice(0, 50) };
  return null;
}
