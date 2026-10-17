import { test } from "node:test";
import assert from "node:assert/strict";
import { RUNNER_SIZE, runnerPose } from "../src/lib/composer-runner.ts";

test("the runner stays on the composer's top edge, turns at the ends and leans the way it goes", () => {
  const width = 600;
  for (let t = 0; t < 30; t += 0.07) {
    const pose = runnerPose(t, width, "slow", false);
    assert.ok(pose.x >= 12 && pose.x + RUNNER_SIZE <= width - 12, `x ${pose.x} at ${t}`);
    assert.ok(pose.lift >= 0 && pose.lift <= 34, `lift ${pose.lift} at ${t}`);
    assert.equal(pose.opacity, 1);
  }
  assert.ok(runnerPose(1, width, "slow", false).lean > 0);
  // Half a lap later (one track length at 85 px/s) it runs back.
  assert.ok(runnerPose((width - RUNNER_SIZE - 24) / 85 + 1, width, "slow", false).lean < 0);
  assert.ok(runnerPose(1, width, "fast", false).x > runnerPose(1, width, "slow", false).x);
});

test("reduced motion parks the runner; the turn's end is one last jump that fades out", () => {
  assert.deepEqual(runnerPose(7.3, 600, "fast", true), { x: 12, lift: 0, lean: 0, scaleX: 1, scaleY: 1, opacity: 1 });
  const middle = runnerPose(2, 600, "slow", false, 0.4);
  assert.ok(middle.lift > runnerPose(2, 600, "slow", false).lift);
  assert.equal(runnerPose(2, 600, "slow", false, 1).opacity, 0);
});
