import test from "node:test";
import assert from "node:assert/strict";
import type { GithubItem } from "../src/client/types.ts";
import { GITHUB_NOTIFIED_LIMIT, normalizeGithubNotified, planPullAlerts, PULL_ALERT_REQUEST_LIMIT, PULL_REFRESH_INTERVAL_MS, pullRefreshDue } from "../src/lib/github-notify.ts";
import { mergeSettings } from "../src/lib/settings.ts";
import { normalizeNotifications, retainActivityNotifications } from "../src/lib/notifications.ts";

const FLOOR = "2026-10-18T10:00:00.000Z";
const pull = (number: number, patch: Partial<GithubItem> = {}): GithubItem => ({
  kind: "pullRequest", repository: "owner/repo", number, title: `Change ${number}`, url: `https://github.com/owner/repo/pull/${number}`,
  state: "open", isDraft: false, author: "ana", createdAt: "2026-10-18T11:00:00Z", updatedAt: "2026-10-18T11:00:00Z",
  headRef: null, baseRef: null, additions: 0, deletions: 0, reviewDecision: null, mergeable: null, labels: [], commentCount: 0,
  assignees: [], reviewRequests: [], checks: null, ...patch,
});

test("the first load ever and an unknown viewer stay silent", () => {
  const items = [pull(1), pull(2, { reviewRequests: ["me"] })];
  const notified: string[] = [];
  assert.deepEqual(planPullAlerts(items, "me", {}, null, notified), { alerts: [], notified });
  assert.deepEqual(planPullAlerts(items, null, {}, FLOOR, notified), { alerts: [], notified });
});

test("only open pull requests by someone else, opened after the floor or asking for my review, alert", () => {
  const items = [
    pull(1),
    pull(2, { author: "Me" }),
    pull(3, { createdAt: "2026-10-17T09:00:00Z", updatedAt: "2026-10-18T12:00:00Z" }),
    pull(4, { createdAt: "2026-10-17T09:00:00Z", updatedAt: "2026-10-18T12:30:00Z", reviewRequests: ["ME"] }),
    pull(5, { kind: "issue" }),
    pull(6, { state: "merged" }),
    pull(7, { author: null }),
    pull(8, { createdAt: "2026-10-18T13:00:00Z", updatedAt: "2026-10-18T13:00:00Z", reviewRequests: ["me"] }),
  ];
  const plan = planPullAlerts(items, "me", {}, FLOOR, []);
  // Newest first; an opening that asks for my review is one review alert.
  assert.deepEqual(plan.alerts, [
    { repository: "owner/repo", number: 8, reason: "reviewRequested" },
    { repository: "owner/repo", number: 4, reason: "reviewRequested" },
    { repository: "owner/repo", number: 1, reason: "opened" },
  ]);
  assert.deepEqual([...plan.notified].sort(), ["opened:owner/repo#1", "opened:owner/repo#8", "review:owner/repo#4", "review:owner/repo#8"]);
  // Remembered: the same list again announces nothing and keeps the list untouched.
  const again = planPullAlerts(items, "me", {}, FLOOR, plan.notified);
  assert.deepEqual(again.alerts, []);
  assert.equal(again.notified, plan.notified);
});

test("items already looked at are remembered quietly and a later review request still alerts", () => {
  const seen = { "owner/repo#1": "2026-10-18T11:00:00Z" };
  const none: string[] = [];
  const quiet = planPullAlerts([pull(1)], "me", seen, FLOOR, none);
  assert.deepEqual(quiet.alerts, []);
  assert.equal(quiet.notified, none);
  // A review request I already looked at is remembered without an alert.
  const looked = planPullAlerts([pull(2, { reviewRequests: ["me"] })], "me", { "owner/repo#2": "2026-10-18T11:00:00Z" }, FLOOR, none);
  assert.deepEqual(looked, { alerts: [], notified: ["review:owner/repo#2"] });
  // A comment later makes it unread, but it is not "opened" again.
  const updated = pull(1, { updatedAt: "2026-10-18T15:00:00Z" });
  assert.deepEqual(planPullAlerts([updated], "me", seen, FLOOR, quiet.notified).alerts, []);
  // Asking for my review afterwards is new.
  const requested = pull(1, { updatedAt: "2026-10-18T16:00:00Z", reviewRequests: ["me"] });
  assert.deepEqual(planPullAlerts([requested], "me", seen, FLOOR, quiet.notified).alerts, [{ repository: "owner/repo", number: 1, reason: "reviewRequested" }]);
});

test("a burst is bounded per request and every candidate is remembered", () => {
  const items = Array.from({ length: PULL_ALERT_REQUEST_LIMIT + 10 }, (_, index) => pull(index + 1, { createdAt: new Date(Date.parse(FLOOR) + (index + 1) * 1000).toISOString(), updatedAt: new Date(Date.parse(FLOOR) + (index + 1) * 1000).toISOString() }));
  const plan = planPullAlerts(items, "me", {}, FLOOR, []);
  assert.equal(plan.alerts.length, PULL_ALERT_REQUEST_LIMIT);
  assert.equal(plan.alerts[0].number, PULL_ALERT_REQUEST_LIMIT + 10);
  assert.equal(plan.notified.length, PULL_ALERT_REQUEST_LIMIT + 10);
  assert.deepEqual(planPullAlerts(items, "me", {}, FLOOR, plan.notified).alerts, []);
});

test("the remembered list is closed, unique and bounded", () => {
  assert.deepEqual(normalizeGithubNotified(["opened:owner/repo#1", "opened:owner/repo#1", "review:o/r#2", "merged:owner/repo#3", "owner/repo#4", 5, "opened:../x#1"]), ["opened:owner/repo#1", "review:o/r#2"]);
  assert.deepEqual(normalizeGithubNotified("opened:owner/repo#1"), []);
  const many = Array.from({ length: GITHUB_NOTIFIED_LIMIT + 5 }, (_, index) => `opened:owner/repo#${index + 1}`);
  assert.equal(normalizeGithubNotified(many).length, GITHUB_NOTIFIED_LIMIT);
  assert.deepEqual(mergeSettings({}).githubNotified, []);
  assert.deepEqual(mergeSettings({ githubNotified: ["review:owner/repo#1", "bad"] }).githubNotified, ["review:owner/repo#1"]);
});

test("the focus refresh waits for the first read and then runs at most once per interval", () => {
  assert.equal(pullRefreshDue(null, 10), false);
  assert.equal(pullRefreshDue(1000, 1000 + PULL_REFRESH_INTERVAL_MS - 1), false);
  assert.equal(pullRefreshDue(1000, 1000 + PULL_REFRESH_INTERVAL_MS), true);
});

test("pull request toasts follow their own switch, on by default", () => {
  assert.equal(normalizeNotifications().pullRequests, true);
  const notice = { id: "pull:opened:owner/repo#1", sessionId: "", kind: "pullRequest" as const, title: "ana opened a pull request in owner/repo", body: "#1 Change", createdAt: 1000, pull: "owner/repo#1" };
  assert.equal(retainActivityNotifications([notice], normalizeNotifications(), 2000).length, 1);
  assert.equal(retainActivityNotifications([notice], normalizeNotifications({ pullRequests: false }), 2000).length, 0);
  assert.equal(retainActivityNotifications([notice], normalizeNotifications({ completion: false }), 2000).length, 1);
});
