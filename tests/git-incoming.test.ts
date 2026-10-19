import { test } from "node:test";
import assert from "node:assert/strict";
import type { GitIncoming } from "../src/client/types.ts";
import { commitAge, incomingButton, pullFeedback, readIncoming, readPullOutcome, turnSettled } from "../src/lib/git-incoming.ts";

const incoming = (extra: Partial<GitIncoming>): GitIncoming => ({
  branch: "main", upstream: "origin/main", ahead: 0, behind: 0, commits: [], checkedAt: null, ...extra,
});

test("the button shows only for a fast-forward, muted when diverged, hidden otherwise", () => {
  assert.deepEqual(incomingButton(null), { kind: "hidden" });
  assert.deepEqual(incomingButton(incoming({})), { kind: "hidden" });
  assert.deepEqual(incomingButton(incoming({ ahead: 2 })), { kind: "hidden" }, "only local commits: nothing to pull");
  assert.deepEqual(incomingButton(incoming({ behind: 3 })), { kind: "pull", count: 3, branch: "main", upstream: "origin/main" });
  assert.deepEqual(incomingButton(incoming({ ahead: 1, behind: 3 })), { kind: "diverged", ahead: 1, behind: 3, branch: "main", upstream: "origin/main" });
});

test("a pull's answer becomes done, blocking files or divergence", () => {
  assert.deepEqual(pullFeedback({ status: "pulled", incoming: incoming({}) }), { kind: "pulled" });
  assert.deepEqual(pullFeedback({ status: "blocked", files: ["a.txt"] }), { kind: "blocked", files: ["a.txt"] });
  assert.deepEqual(pullFeedback({ status: "diverged", incoming: incoming({ ahead: 1, behind: 2 }) }), { kind: "diverged", ahead: 1, behind: 2 });
});

test("a turn settles when a working conversation stops working", () => {
  assert.equal(turnSettled("running", "completed"), true);
  assert.equal(turnSettled("waiting", "failed"), true);
  assert.equal(turnSettled("idle", "running"), false);
  assert.equal(turnSettled("running", "waiting"), false);
  assert.equal(turnSettled(undefined, "completed"), false);
});

test("native answers are validated and commits read", () => {
  const raw = {
    branch: "main", upstream: "origin/main", ahead: 0, behind: 3, checkedAt: 1_700_000_000_000,
    commits: [
      { sha: "abc1234", subject: "Fix it", author: "Ana", time: 1_700_000_000 },
      { sha: "not hex", subject: "x", author: "y", time: 1 },
      { sha: "def5678", subject: 5, author: "y", time: 1 },
    ],
  };
  const read = readIncoming(raw);
  assert.equal(read?.commits.length, 1);
  assert.equal(read?.commits[0].sha, "abc1234");
  assert.equal(read?.checkedAt, 1_700_000_000_000);
  assert.equal(readIncoming(null), null);
  assert.equal(readIncoming({ ...raw, behind: -1 }), null);
  assert.equal(readIncoming({ ...raw, upstream: "" }), null);
  assert.equal(readIncoming({ ...raw, checkedAt: "soon" })?.checkedAt, null);

  assert.deepEqual(readPullOutcome({ status: "blocked", files: ["a.txt", 3, ""] }), { status: "blocked", files: ["a.txt"] });
  assert.equal(readPullOutcome({ status: "pulled", incoming: null })?.status, "pulled");
  assert.equal(readPullOutcome({ status: "merged" }), null);
  assert.equal(readPullOutcome("pulled"), null);

  const commit = { sha: "abc1234", subject: "s", author: "a", time: 1_700_000_000 };
  assert.equal(commitAge(commit, 1_700_000_000_000 + 30_000), "now");
  assert.equal(commitAge(commit, 1_700_000_000_000 + 2 * 3_600_000), "2h");
});
