import { test } from "node:test";
import assert from "node:assert/strict";
import { nestTeamSessions, stripTeamPlan, taskView, workerChanges } from "../src/lib/team.ts";
import { composerDebugging, composerTeam, emptyComposerContext } from "../src/lib/composer-context.ts";
import type { Session, TeamTask, TurnReview } from "../src/client/types.ts";

const session = (id: string, extra: Partial<Session> = {}): Session => ({ id, title: id, projectId: "p", agent: "codex", status: "idle", createdAt: "t", lastActivityAt: "t", worktree: { path: "/x", branch: "main", isolated: false }, messages: [], lastError: null, ...extra });

test("the coordinator's plan block never shows, even while it streams", () => {
  assert.equal(stripTeamPlan("I split it.\n<sirus_team_plan>{\"tasks\":[]}</sirus_team_plan>"), "I split it.");
  assert.equal(stripTeamPlan("I split it.\n<sirus_team_plan>{\"tas"), "I split it.");
  assert.equal(stripTeamPlan("No plan here"), "No plan here");
});

test("helpers follow their coordinator and orphans stay top-level", () => {
  const rows = nestTeamSessions([
    session("w1", { teamWorker: { coordinatorSessionId: "lead", taskId: "t1" } }),
    session("other"),
    session("lead"),
    session("orphan", { teamWorker: { coordinatorSessionId: "gone", taskId: "t2" } }),
  ]);
  assert.deepEqual(rows.map(row => [row.session.id, row.child]), [["other", false], ["lead", false], ["w1", true], ["orphan", false]]);
});

test("task view combines plan state with the helper's live session", () => {
  const task = { state: "running" } as TeamTask;
  assert.equal(taskView(task, session("w", { status: "waiting" })), "needs");
  assert.equal(taskView(task, session("w", { status: "running" })), "running");
  assert.equal(taskView(task, session("w", { status: "idle" })), "queued");
  assert.equal(taskView({ state: "pending" } as TeamTask, undefined), "pending");
});

test("change totals come only from a reported native review", () => {
  assert.equal(workerChanges(session("w")), null);
  const review: TurnReview = { files: [{ path: "a", kind: "modified", additions: 3, deletions: 1, binary: false, diff: null }, { path: "b", kind: "added", additions: 5, deletions: 0, binary: false, diff: null }], partial: false, sharedWorkspace: false, keptAt: null, expired: false };
  const worker = session("w", { messages: [{ id: "m", sessionId: "w", role: "agent", content: "", createdAt: "t", streaming: false, activity: { provider: "codex", model: null, startedAt: 0, endedAt: 1, waitingSince: null, pausedMs: 0, status: "completed", items: [], truncated: false, review } }] });
  assert.deepEqual(workerChanges(worker), { files: 2, additions: 8, deletions: 1 });
});

test("team mode replaces planning and debugging, and debugging turns team off", () => {
  const team = composerTeam({ ...emptyComposerContext, planning: true, debugging: true }, true);
  assert.equal(team.team, true); assert.equal(team.planning, false); assert.equal(team.debugging, false);
  assert.equal(composerDebugging(team, true).team, false);
});
