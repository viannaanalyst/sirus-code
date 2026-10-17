import type { GithubItem } from "@/client/types";
import { itemKey } from "./github-inbox";

/**
 * Unread pull requests and issues on the Pull requests page (ADR-050).
 * `seen` maps `owner/repo#n` to the `updatedAt` last seen; `floor` is a time
 * before which everything counts as seen (set by the first load and by "Mark all as read").
 * Before the first load (`floor` null) nothing is unread, so existing items do not flood the list.
 */
export const GITHUB_SEEN_LIMIT = 500;
export const GITHUB_SEEN_KEY = /^[A-Za-z0-9-]{1,100}\/[A-Za-z0-9._-]{1,100}#[1-9]\d{0,7}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export type GithubSeen = Record<string, string>;
type Seeable = Pick<GithubItem, "repository" | "number" | "updatedAt">;

const time = (value: string | null | undefined) => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

export const validSeenTime = (value: unknown): value is string => typeof value === "string" && RFC3339.test(value) && time(value) !== null;

/** Valid entries only, without those at or before the floor, newest `GITHUB_SEEN_LIMIT` kept. */
export function normalizeGithubSeen(value: unknown, floor: string | null = null): GithubSeen {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const bottom = time(floor) ?? -Infinity;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => GITHUB_SEEN_KEY.test(entry[0]) && validSeenTime(entry[1]) && (time(entry[1]) as number) > bottom)
    .sort((a, b) => (time(b[1]) as number) - (time(a[1]) as number))
    .slice(0, GITHUB_SEEN_LIMIT);
  return Object.fromEntries(entries);
}

export const normalizeGithubSeenFloor = (value: unknown): string | null => validSeenTime(value) ? value : null;

export function isGithubItemUnread(item: Seeable, seen: GithubSeen, floor: string | null): boolean {
  const bottom = time(floor);
  const updated = time(item.updatedAt);
  if (bottom === null || updated === null) return false;
  return updated > Math.max(bottom, time(seen[itemKey(item)]) ?? -Infinity);
}

export function hasUnreadGithubItems(items: Iterable<Seeable>, seen: GithubSeen, floor: string | null): boolean {
  if (time(floor) === null) return false;
  for (const item of items) if (isGithubItemUnread(item, seen, floor)) return true;
  return false;
}

/** The map after looking at `item`, or null when it was already seen (nothing to save). */
export function markGithubItemSeen(seen: GithubSeen, floor: string | null, item: Seeable): GithubSeen | null {
  if (!isGithubItemUnread(item, seen, floor) || !validSeenTime(item.updatedAt) || !GITHUB_SEEN_KEY.test(itemKey(item))) return null;
  return normalizeGithubSeen({ ...seen, [itemKey(item)]: item.updatedAt }, floor);
}

/** The floor for "Mark all as read" and the first load: now, or the newest item if the clock lags. */
export function githubSeenFloor(items: Iterable<Seeable>, current: string | null, now = Date.now()): string {
  let newest = Math.max(now, time(current) ?? -Infinity);
  for (const item of items) newest = Math.max(newest, time(item.updatedAt) ?? -Infinity);
  return new Date(newest).toISOString();
}
