import { test } from "node:test";
import assert from "node:assert/strict";
import type { GithubItem } from "../src/client/types.ts";
import { PULL_ASK_DESCRIPTION_LIMIT, PULL_ASK_MIN_WIDTH, clampPullAskWidth, findPullAsk, isAuxiliarySession, pullAskContext, pullAskKey } from "../src/lib/pull-ask.ts";

const item = (overrides: Partial<GithubItem> = {}): GithubItem => ({
  kind: "pullRequest", repository: "acme/app", number: 12, title: "Paginate orders", url: "https://github.com/acme/app/pull/12",
  state: "open", isDraft: false, author: "octo", createdAt: "t", updatedAt: "t", headRef: "feature/pages", baseRef: "main",
  additions: 1, deletions: 0, reviewDecision: null, mergeable: null, labels: [], reviewRequests: [], assignees: [], commentCount: 0, checks: null,
  ...overrides,
} as GithubItem);

const origin = (repository: string, number: number) => ({ repository, number, kind: "pullRequest" as const, title: "T", state: "open" as const, author: null, headRef: null, baseRef: null, description: "" });

test("side chats and Ask conversations are hidden from lists; ordinary ones are not", () => {
  assert.equal(isAuxiliarySession({}), false);
  assert.equal(isAuxiliarySession({ sideChat: null, pullAsk: null }), false);
  assert.equal(isAuxiliarySession({ sideChat: { parentSessionId: "p" } }), true);
  assert.equal(isAuxiliarySession({ pullAsk: origin("acme/app", 1) }), true);
});

test("one conversation per item, matched case-insensitively by repository and number", () => {
  const sessions = [{ id: "a", pullAsk: origin("Acme/App", 12) }, { id: "b", pullAsk: origin("acme/app", 13) }, { id: "c", pullAsk: null }];
  assert.equal(findPullAsk(sessions, "acme/app", 12)?.id, "a");
  assert.equal(findPullAsk(sessions, "acme/app", 13)?.id, "b");
  assert.equal(findPullAsk(sessions, "acme/other", 12), null);
  assert.equal(pullAskKey({ repository: "acme/app", number: 12 }), "acme/app#12");
});

test("the context carries draft state and branches for pull requests only, with a bounded description", () => {
  const draft = pullAskContext(item({ isDraft: true }), `  ${"é".repeat(PULL_ASK_DESCRIPTION_LIMIT + 50)}  `);
  assert.equal(draft.state, "draft");
  assert.equal(draft.headRef, "feature/pages");
  assert.equal(Array.from(draft.description).length, PULL_ASK_DESCRIPTION_LIMIT);
  assert.equal(pullAskContext(item({ state: "merged", isDraft: true }), "").state, "merged");
  const issue = pullAskContext(item({ kind: "issue", headRef: "x", baseRef: "y" }), "Body");
  assert.deepEqual([issue.state, issue.headRef, issue.baseRef, issue.description], ["open", null, null, "Body"]);
});

test("the panel keeps a minimum width and leaves room for the detail", () => {
  assert.equal(clampPullAskWidth(100, 1400), PULL_ASK_MIN_WIDTH);
  assert.equal(clampPullAskWidth(2000, 1000), 600);
  assert.equal(clampPullAskWidth(500, 400), PULL_ASK_MIN_WIDTH);
});
