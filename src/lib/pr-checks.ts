// The pull request Checks tab (ADR-050): durations, which failures to fix, and how a
// requested fix is going. A CI auto-fix run (ADR-064) on the same pull request is the
// source of truth while it is active; otherwise a memory-only note of the person's own
// "Fix with AI" request is compared with what GitHub reports on the next load.
import type { CiFixState, GithubCheck, GithubFailedCheck, GithubItem } from "@/client/types";

/** How long a finished check ran, in milliseconds, or null when unknown. */
export function checkDuration(check: Pick<GithubCheck, "startedAt" | "completedAt">): number | null {
  if (!check.startedAt || !check.completedAt) return null;
  const ms = Date.parse(check.completedAt) - Date.parse(check.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/** `45s`, `3m 12s`, `1h 4m`. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  return minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${Math.floor(minutes / 60)}h`;
}

const ORDER: Record<GithubCheck["status"], number> = { failed: 0, pending: 1, unknown: 2, passed: 3, skipped: 4 };

/** Failures first, then running, passed and skipped; names alphabetical within each. */
export function sortChecks<T extends Pick<GithubCheck, "name" | "status">>(checks: readonly T[]): T[] {
  return [...checks].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name));
}

/** Distinct names of the failing checks, in display order. */
export function failingNames(checks: readonly Pick<GithubCheck, "name" | "status">[]): string[] {
  return [...new Set(sortChecks(checks).filter((check) => check.status === "failed").map((check) => check.name))];
}

/** What the `failures` lookup reported for one check: same link first, then same name. */
export function failureFor(failures: readonly GithubFailedCheck[] | null | undefined, check: Pick<GithubCheck, "name" | "url">): GithubFailedCheck | null {
  if (!failures) return null;
  return (check.url ? failures.find((failure) => failure.url === check.url) : undefined) ?? failures.find((failure) => failure.name === check.name) ?? null;
}

/** A "Fix with AI" the person started from this page, remembered until dismissed or restart. */
export interface FixRequest { head: string | null; checks: string[]; at: number }
export type FixPhase =
  | { phase: "fixing"; source: "autoFix" | "manual"; attempts: number }
  | { phase: "waiting" | "passed" | "failing"; source: "autoFix" | "manual"; attempts: number }
  | { phase: "paused"; source: "autoFix"; attempts: number; reason: CiFixState["reason"] };

/** The CI auto-fix entry that follows this pull request, if any. */
export function autoFixFor(states: readonly CiFixState[], item: Pick<GithubItem, "repository" | "number">): CiFixState | null {
  const prefix = `https://github.com/${item.repository}/pull/`.toLowerCase();
  return states.find((state) => state.pullRequest === item.number && state.url.toLowerCase().startsWith(prefix)) ?? null;
}

function fromChecks(checks: readonly Pick<GithubCheck, "name" | "status">[], names: readonly string[]): "waiting" | "passed" | "failing" {
  const named = checks.filter((check) => names.includes(check.name));
  const watched = named.length ? named : checks;
  if (watched.some((check) => check.status === "failed")) return "failing";
  if (watched.some((check) => check.status === "pending" || check.status === "unknown")) return "waiting";
  return "passed";
}

/**
 * Where a fix stands: an active CI auto-fix run wins; otherwise a manual request is
 * "fixing" until the head moves, then follows the checks it asked about.
 */
export function fixProgress(
  detail: { headOid: string | null; checks: readonly Pick<GithubCheck, "name" | "status">[] },
  request: FixRequest | null,
  autoFix: CiFixState | null,
): FixPhase | null {
  if (autoFix && autoFix.status !== "off") {
    if (autoFix.status === "fixing") return { phase: "fixing", source: "autoFix", attempts: autoFix.attempts };
    if (autoFix.status === "paused") return { phase: "paused", source: "autoFix", attempts: autoFix.attempts, reason: autoFix.reason ?? null };
    if (autoFix.attempts > 0) return { phase: fromChecks(detail.checks, autoFix.checks), source: "autoFix", attempts: autoFix.attempts };
  }
  if (!request) return null;
  if (!detail.headOid || detail.headOid === request.head) return { phase: "fixing", source: "manual", attempts: 1 };
  return { phase: fromChecks(detail.checks, request.checks), source: "manual", attempts: 1 };
}

// Memory-only: requests live for this run of the app, like the inbox lists themselves.
const MAX_REQUESTS = 50;
const requests = new Map<string, FixRequest>();
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

export function rememberFixRequest(key: string, request: FixRequest) {
  requests.delete(key);
  requests.set(key, request);
  while (requests.size > MAX_REQUESTS) requests.delete(requests.keys().next().value!);
  notify();
}
export function forgetFixRequest(key: string) { if (requests.delete(key)) notify(); }
export function fixRequest(key: string): FixRequest | null { return requests.get(key) ?? null; }
export function subscribeFixRequests(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
