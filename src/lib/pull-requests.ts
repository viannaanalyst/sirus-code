import type { AppSettings, CiFixState, PrWatch, PrWatchEvent, PullRequest, PullRequestCheckStatus, PullRequestLookupStatus, PullRequestSnapshot } from "@/client/types";

export interface PullRequestLoadState {
  workspacePath: string;
  loading: boolean;
  error: string | null;
  snapshot: PullRequestSnapshot | null;
}
export function checkSummary(pr: PullRequest): { status: PullRequestCheckStatus | "none"; label: string } {
  if (pr.checks.some(check => check.status === "failed")) return { status: "failed", label: "Checks failed" };
  if (!pr.checksComplete || pr.checksTruncated) return { status: "unknown", label: "Checks incomplete" };
  if (!pr.checks.length) return { status: "none", label: "No checks reported" };
  if (pr.checks.some(check => check.status === "unknown")) return { status: "unknown", label: "Checks unavailable" };
  if (pr.checks.some(check => check.status === "pending")) return { status: "pending", label: "Checks in progress" };
  return pr.checks.some(check => check.status === "passed") ? { status: "passed", label: "Checks passed" } : { status: "skipped", label: "Checks skipped" };
}
export const lookupLabels: Record<Exclude<PullRequestLookupStatus, "ready">, string> = {
  noPullRequest: "No pull request for this branch.", notGit: "This workspace is not a Git repository.", noCommit: "Create the first commit to see a pull request.",
  unsupportedRemote: "A GitHub origin is required.", detached: "Select a branch to see its pull request.", cliMissing: "Install GitHub CLI (gh) to load pull requests.",
  authRequired: "Connect GitHub CLI with gh auth login.", unavailable: "Could not load the pull request. Check GitHub CLI access and refresh.",
};
export function pullRequestState(pr: PullRequest): string {
  return pr.state === "merged" ? "Merged" : pr.state === "closed" ? "Closed" : pr.draft ? "Draft" : "Ready for review";
}

/**
 * What a PR watch (ADR-079) wakes its session for. Failing checks are left to
 * CI auto-fix (ADR-064) while it is on and not turned off for the session.
 */
export function watchedEvents(watch: Pick<PrWatch, "sessionId">, settings: Pick<AppSettings, "ciAutoFix">, fixes: Pick<CiFixState, "sessionId" | "status">[]): { events: PrWatchEvent[]; checksByAutoFix: boolean } {
  const checksByAutoFix = settings.ciAutoFix && !fixes.some(fix => fix.sessionId === watch.sessionId && fix.status === "off");
  return { events: checksByAutoFix ? ["reviews", "conflict"] : ["checks", "reviews", "conflict"], checksByAutoFix };
}
/** Watches of one GitHub pull request (case-insensitive repository), active first. */
export function watchesFor(watches: PrWatch[], repository: string, number: number): PrWatch[] {
  return watches.filter(watch => watch.pullRequest === number && watch.repository.toLowerCase() === repository.toLowerCase())
    .sort((a, b) => (a.status === "watching" ? 0 : 1) - (b.status === "watching" ? 0 : 1));
}
