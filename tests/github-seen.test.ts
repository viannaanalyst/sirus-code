import { test } from "node:test";
import assert from "node:assert/strict";
import { GITHUB_SEEN_LIMIT, githubSeenFloor, hasUnreadGithubItems, isGithubItemUnread, markGithubItemSeen, normalizeGithubSeen, normalizeGithubSeenFloor } from "../src/lib/github-seen.ts";
import { mergeSettings } from "../src/lib/settings.ts";

const item = (number: number, updatedAt: string) => ({ repository: "acme/app", number, updatedAt });
const FLOOR = "2026-10-01T00:00:00Z";

test("nothing is unread before the first load sets a floor", () => {
  assert.equal(isGithubItemUnread(item(1, "2026-10-17T00:00:00Z"), {}, null), false);
  assert.equal(hasUnreadGithubItems([item(1, "2026-10-17T00:00:00Z")], {}, null), false);
});

test("an item is unread when updated after the floor and after the last time it was seen", () => {
  assert.equal(isGithubItemUnread(item(1, "2026-09-30T00:00:00Z"), {}, FLOOR), false);
  assert.equal(isGithubItemUnread(item(1, "2026-10-02T00:00:00Z"), {}, FLOOR), true);
  const seen = { "acme/app#1": "2026-10-02T00:00:00Z" };
  assert.equal(isGithubItemUnread(item(1, "2026-10-02T00:00:00Z"), seen, FLOOR), false);
  assert.equal(isGithubItemUnread(item(1, "2026-10-03T00:00:00Z"), seen, FLOOR), true);
  assert.equal(isGithubItemUnread(item(1, "garbage"), {}, FLOOR), false);
  assert.equal(hasUnreadGithubItems([item(1, "2026-10-02T00:00:00Z"), item(2, "2026-10-04T00:00:00Z")], seen, FLOOR), true);
});

test("opening an item stores its updatedAt, and only when it was unread", () => {
  const next = markGithubItemSeen({}, FLOOR, item(7, "2026-10-05T10:00:00Z"));
  assert.deepEqual(next, { "acme/app#7": "2026-10-05T10:00:00Z" });
  assert.equal(markGithubItemSeen(next!, FLOOR, item(7, "2026-10-05T10:00:00Z")), null);
  assert.equal(markGithubItemSeen({}, null, item(7, "2026-10-05T10:00:00Z")), null);
});

test("the floor is now, or the newest item when the clock lags", () => {
  const now = Date.parse("2026-10-10T00:00:00Z");
  assert.equal(githubSeenFloor([item(1, "2026-10-01T00:00:00Z")], null, now), "2026-10-10T00:00:00.000Z");
  assert.equal(githubSeenFloor([item(1, "2026-10-11T00:00:00Z")], null, now), "2026-10-11T00:00:00.000Z");
  assert.equal(githubSeenFloor([], "2026-10-12T00:00:00Z", now), "2026-10-12T00:00:00.000Z");
});

test("seen markers are validated, pruned below the floor and bounded to the newest", () => {
  const seen = normalizeGithubSeen({
    "acme/app#1": "2026-10-02T00:00:00Z",
    "acme/app#2": "2026-09-01T00:00:00Z",
    "acme/app#0": "2026-10-02T00:00:00Z",
    "../x#1": "2026-10-02T00:00:00Z",
    "acme/app#3": "yesterday",
    "acme/app#4": 5,
  }, FLOOR);
  assert.deepEqual(seen, { "acme/app#1": "2026-10-02T00:00:00Z" });
  assert.deepEqual(normalizeGithubSeen(["acme/app#1"]), {});
  const many = Object.fromEntries(Array.from({ length: GITHUB_SEEN_LIMIT + 20 }, (_, index) => [`acme/app#${index + 1}`, new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString()]));
  const bounded = normalizeGithubSeen(many);
  assert.equal(Object.keys(bounded).length, GITHUB_SEEN_LIMIT);
  assert.ok(!("acme/app#1" in bounded));
  assert.ok(`acme/app#${GITHUB_SEEN_LIMIT + 20}` in bounded);
  assert.equal(normalizeGithubSeenFloor("2026-10-01T00:00:00+02:00"), "2026-10-01T00:00:00+02:00");
  assert.equal(normalizeGithubSeenFloor("2026-10-01 00:00:00"), null);
});

test("settings merge keeps valid seen markers and drops the rest", () => {
  const merged = mergeSettings({ githubSeenFloor: FLOOR, githubSeen: { "acme/app#1": "2026-10-02T00:00:00Z", "bad": "2026-10-02T00:00:00Z" } } as never);
  assert.equal(merged.githubSeenFloor, FLOOR);
  assert.deepEqual(merged.githubSeen, { "acme/app#1": "2026-10-02T00:00:00Z" });
  const empty = mergeSettings({} as never);
  assert.equal(empty.githubSeenFloor, null);
  assert.deepEqual(empty.githubSeen, {});
});
