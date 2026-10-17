import { test } from "node:test";
import assert from "node:assert/strict";
import { autoFixFor, checkDuration, failingNames, failureFor, fixProgress, fixRequest, forgetFixRequest, formatDuration, rememberFixRequest, sortChecks, subscribeFixRequests } from "../src/lib/pr-checks.ts";
import type { CiFixState, GithubCheck } from "../src/client/types.ts";

const check = (name: string, status: GithubCheck["status"], extra: Partial<GithubCheck> = {}): GithubCheck => ({ name, status, url: null, ...extra });
const auto = (extra: Partial<CiFixState>): CiFixState => ({ sessionId: "s", pullRequest: 7, url: "https://github.com/acme/app/pull/7", status: "watching", attempts: 0, checks: [], updatedAt: "t", ...extra });

test("durations come from finished checks only and read compactly", () => {
  assert.equal(checkDuration({ startedAt: "2026-10-01T10:00:00Z", completedAt: "2026-10-01T10:03:12Z" }), 192_000);
  assert.equal(checkDuration({ startedAt: "2026-10-01T10:00:00Z", completedAt: null }), null);
  assert.equal(checkDuration({ startedAt: "2026-10-01T10:05:00Z", completedAt: "2026-10-01T10:00:00Z" }), null);
  assert.equal(checkDuration({ startedAt: "x", completedAt: "y" }), null);
  assert.deepEqual([45_000, 192_000, 180_000, 3_840_000, 7_200_000].map(formatDuration), ["45s", "3m 12s", "3m", "1h 4m", "2h"]);
});

test("failures sort first and match the failures lookup by link, then name", () => {
  const checks = [check("b", "passed"), check("z", "failed"), check("a", "pending"), check("c", "failed"), check("c", "failed")];
  assert.deepEqual(sortChecks(checks).map((row) => `${row.name}:${row.status}`), ["c:failed", "c:failed", "z:failed", "a:pending", "b:passed"]);
  assert.deepEqual(failingNames(checks), ["c", "z"]);
  const failures = [{ name: "test", url: "https://github.com/acme/app/runs/2", summary: null, annotations: [], log: "two" }, { name: "test", url: "https://github.com/acme/app/runs/1", summary: null, annotations: [], log: "one" }];
  assert.equal(failureFor(failures, { name: "test", url: "https://github.com/acme/app/runs/1" })?.log, "one");
  assert.equal(failureFor(failures, { name: "test", url: null })?.log, "two");
  assert.equal(failureFor(failures, { name: "other", url: null }), null);
  assert.equal(failureFor(null, { name: "test", url: null }), null);
});

test("a manual fix is fixing until the head moves, then follows the checks it asked about", () => {
  const request = { head: "a".repeat(40), checks: ["test"], at: 1 };
  assert.equal(fixProgress({ headOid: "a".repeat(40), checks: [check("test", "failed")] }, null, null), null);
  assert.deepEqual(fixProgress({ headOid: "a".repeat(40), checks: [check("test", "failed")] }, request, null), { phase: "fixing", source: "manual", attempts: 1 });
  const moved = "b".repeat(40);
  assert.equal(fixProgress({ headOid: moved, checks: [check("test", "pending"), check("lint", "failed")] }, request, null)?.phase, "waiting");
  assert.equal(fixProgress({ headOid: moved, checks: [check("test", "passed"), check("lint", "failed")] }, request, null)?.phase, "passed", "only the picked checks count");
  assert.equal(fixProgress({ headOid: moved, checks: [check("test", "failed")] }, request, null)?.phase, "failing");
  assert.equal(fixProgress({ headOid: moved, checks: [check("renamed", "passed")] }, request, null)?.phase, "passed", "renamed checks fall back to every check");
});

test("an active CI auto-fix run on the same pull request wins over a manual note", () => {
  const states = [auto({ url: "https://github.com/acme/other/pull/7" }), auto({ status: "fixing", attempts: 2 })];
  const found = autoFixFor(states, { repository: "Acme/App", number: 7 });
  assert.equal(found, states[1]);
  assert.equal(autoFixFor(states, { repository: "acme/app", number: 8 }), null);
  const detail = { headOid: "b".repeat(40), checks: [check("test", "passed")] };
  const request = { head: "b".repeat(40), checks: ["test"], at: 1 };
  assert.deepEqual(fixProgress(detail, request, found), { phase: "fixing", source: "autoFix", attempts: 2 });
  assert.deepEqual(fixProgress(detail, null, auto({ status: "paused", attempts: 3, reason: "attemptLimit" })), { phase: "paused", source: "autoFix", attempts: 3, reason: "attemptLimit" });
  assert.deepEqual(fixProgress({ ...detail, checks: [check("test", "pending")] }, null, auto({ attempts: 1, checks: ["test"] })), { phase: "waiting", source: "autoFix", attempts: 1 });
  assert.equal(fixProgress(detail, null, auto({ attempts: 0 })), null, "a watching run that never fixed shows nothing");
  assert.equal(fixProgress(detail, request, auto({ status: "off", attempts: 2 }))?.source, "manual");
});

test("fix requests are memory-only, bounded and notify their listeners", () => {
  let calls = 0;
  const stop = subscribeFixRequests(() => { calls++; });
  rememberFixRequest("acme/app#1", { head: null, checks: ["a"], at: 1 });
  assert.deepEqual(fixRequest("acme/app#1")?.checks, ["a"]);
  for (let index = 2; index <= 60; index++) rememberFixRequest(`acme/app#${index}`, { head: null, checks: [], at: index });
  assert.equal(fixRequest("acme/app#1"), null, "the oldest request goes past 50");
  forgetFixRequest("acme/app#60");
  forgetFixRequest("acme/app#60");
  assert.equal(fixRequest("acme/app#60"), null);
  stop();
  assert.equal(calls, 61, "60 remembers and one forget; the repeated forget is silent");
});
