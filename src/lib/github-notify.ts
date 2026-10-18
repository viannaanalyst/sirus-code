import type { GithubItem } from "@/client/types";
import { itemKey } from "./github-inbox";
import { isGithubItemUnread, type GithubSeen } from "./github-seen";

/**
 * Pull request alerts (ADR-050 amendment, 2026-10-18): which open pull requests of saved
 * projects deserve a notification after a list loads. Native confirms each one against its own
 * last list, writes the text and shows at most three on their own, the rest in one summary.
 */
export type PullAlertReason = "opened" | "reviewRequested";
export interface PullAlertRequest { repository: string; number: number; reason: PullAlertReason }

/** Alerts remembered across restarts in `githubNotified` (`opened:owner/repo#n`, `review:owner/repo#n`). */
export const GITHUB_NOTIFIED_LIMIT = 200;
/** Most pull requests one alert request names (native refuses more). */
export const PULL_ALERT_REQUEST_LIMIT = 50;
const NOTIFIED_ENTRY = /^(?:opened|review):[A-Za-z0-9-]{1,100}\/[A-Za-z0-9._-]{1,100}#[1-9]\d{0,7}$/;

/** At most one alert check per this interval when the window comes back (no polling). */
export const PULL_REFRESH_INTERVAL_MS = 5 * 60_000;

export function normalizeGithubNotified(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && NOTIFIED_ENTRY.test(entry)))].slice(0, GITHUB_NOTIFIED_LIMIT);
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const time = (value: string) => { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : -Infinity; };

/**
 * The alerts for a loaded list of open pull requests, newest first, and the `githubNotified`
 * list to save (unchanged, the same array, when there is nothing new). Nothing before the first
 * load ever (`floor` null: it then marks everything seen) or without a known viewer. Only items
 * someone else authored that the person has not looked at since their last update qualify:
 * opened after the floor, or naming the person as a requested reviewer. Each item alerts once
 * per reason; a review request that comes with the opening is one alert.
 */
export function planPullAlerts(items: readonly GithubItem[], viewer: string | null, seen: GithubSeen, floor: string | null, notified: readonly string[]): { alerts: PullAlertRequest[]; notified: readonly string[] } {
  if (!floor || !viewer) return { alerts: [], notified };
  const known = new Set(notified);
  const fresh: { request: PullAlertRequest; at: number; marks: string[] }[] = [];
  const quiet: string[] = [];
  for (const item of items) {
    if (item.kind !== "pullRequest" || item.state !== "open" || !item.author || same(item.author, viewer)) continue;
    const key = itemKey(item);
    const opened = time(item.createdAt) > time(floor) && !(key in seen) && !known.has(`opened:${key}`);
    const review = item.reviewRequests.some((login) => same(login, viewer)) && !known.has(`review:${key}`);
    if (!opened && !review) continue;
    // Already looked at since its last update: remembered without an alert, so a later
    // comment does not announce it as new.
    if (!isGithubItemUnread(item, seen, floor)) { quiet.push(...(review ? [`review:${key}`] : []), ...(opened ? [`opened:${key}`] : [])); continue; }
    if (review) fresh.push({ request: { repository: item.repository, number: item.number, reason: "reviewRequested" }, at: time(item.updatedAt), marks: [`review:${key}`, ...(opened ? [`opened:${key}`] : [])] });
    else if (opened) fresh.push({ request: { repository: item.repository, number: item.number, reason: "opened" }, at: time(item.createdAt), marks: [`opened:${key}`] });
  }
  if (!fresh.length && !quiet.length) return { alerts: [], notified };
  fresh.sort((a, b) => b.at - a.at);
  return {
    alerts: fresh.slice(0, PULL_ALERT_REQUEST_LIMIT).map((entry) => entry.request),
    // Every candidate is remembered, also those past the request limit, so none comes back later.
    notified: normalizeGithubNotified([...fresh.flatMap((entry) => entry.marks), ...quiet, ...notified]),
  };
}

/**
 * Whether a window that regains focus should read the open pull requests again: only after the
 * start-up read (or the page) has asked once, and then at most once per interval.
 */
export function pullRefreshDue(lastRead: number | null, now = Date.now()): boolean {
  return lastRead !== null && now - lastRead >= PULL_REFRESH_INTERVAL_MS;
}
