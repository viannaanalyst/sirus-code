import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { runningClocks, subscribeClock } from "../src/lib/shared-clock.ts";

test("subscribers of one interval share a single timer that stops with the last one", () => {
  mock.timers.enable({ apis: ["setInterval", "Date"] });
  try {
    let a = 0, b = 0;
    const offA = subscribeClock(1000, () => { a += 1; });
    const offB = subscribeClock(1000, () => { b += 1; });
    assert.equal(runningClocks(), 1, "two listeners, one timer");
    mock.timers.tick(3000);
    assert.deepEqual([a, b], [3, 3]);
    offA();
    mock.timers.tick(1000);
    assert.deepEqual([a, b], [3, 4]);
    offB();
    assert.equal(runningClocks(), 0, "nothing listens, nothing runs");
    mock.timers.tick(5000);
    assert.deepEqual([a, b], [3, 4]);
  } finally {
    mock.timers.reset();
  }
});

test("different intervals keep separate timers", () => {
  mock.timers.enable({ apis: ["setInterval", "Date"] });
  try {
    const offSecond = subscribeClock(1000, () => undefined);
    const offHalf = subscribeClock(500, () => undefined);
    assert.equal(runningClocks(), 2);
    offSecond();
    offHalf();
    assert.equal(runningClocks(), 0);
  } finally {
    mock.timers.reset();
  }
});
