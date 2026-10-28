import { test } from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_INTERVAL, OutputScheduler, VISIBLE_INTERVAL } from "../src/lib/output-scheduler.ts";

type Event = { sessionId: string; n: number };

function harness(visible: string[] = ["a"]) {
  let time = 0;
  let hidden = false;
  let frame: (() => void) | null = null;
  let timer: { at: number; run: () => void } | null = null;
  const applied: Event[][] = [];
  const scheduler = new OutputScheduler<Event>({
    apply: (events) => { applied.push(events); },
    isVisible: (id) => visible.includes(id),
    documentHidden: () => hidden,
    now: () => time,
    frame: (run) => { frame = run; return () => { frame = null; }; },
    timer: (run, ms) => { timer = { at: time + ms, run }; return () => { timer = null; }; },
  });
  /** Advances 16 ms: due timers fire, then the animation frame. */
  const tick = () => {
    time += 16;
    if (timer && timer.at <= time) { const run = timer.run; timer = null; run(); }
    if (frame && !hidden) { const run = frame; frame = null; run(); }
  };
  return { scheduler, applied, tick, setHidden: (value: boolean) => { hidden = value; }, visible };
}

test("a visible conversation applies a stream of deltas at most ~30 times a second", () => {
  const { scheduler, applied, tick } = harness();
  let n = 0;
  // One second of 16 ms ticks with two deltas each.
  for (let i = 0; i < 62; i += 1) { scheduler.queue({ sessionId: "a", n: n++ }); scheduler.queue({ sessionId: "a", n: n++ }); tick(); }
  assert.ok(applied.length <= Math.ceil(1000 / VISIBLE_INTERVAL) + 1, `applied ${applied.length} times`);
  assert.ok(applied.length >= 20, "still updates steadily");
  const seen = applied.flat().map((event) => event.n);
  assert.deepEqual(seen, Array.from({ length: seen.length }, (_, index) => index), "order is kept");
});

test("a conversation that is not shown waits for the background cadence, then flushes when shown", () => {
  const { scheduler, applied, tick, visible } = harness(["a"]);
  for (let i = 0; i < 10; i += 1) { scheduler.queue({ sessionId: "b", n: i }); tick(); }
  assert.equal(applied.length, 0, "no re-render per delta");
  for (let i = 0; i < Math.ceil(BACKGROUND_INTERVAL / 16); i += 1) tick();
  assert.equal(applied.length, 1);
  assert.equal(applied[0].length, 10);
  scheduler.queue({ sessionId: "b", n: 10 });
  visible.push("b");
  scheduler.flush();
  assert.equal(applied.length, 2, "shown: applied at once");
});

test("a hidden document applies everything on the slow cadence", () => {
  const { scheduler, applied, tick, setHidden } = harness();
  setHidden(true);
  for (let i = 0; i < 12; i += 1) { scheduler.queue({ sessionId: "a", n: i }); tick(); }
  assert.ok(applied.length <= 1);
  for (let i = 0; i < 20; i += 1) tick();
  assert.equal(applied.flat().length, 12);
});

test("cancel drops what is queued", () => {
  const { scheduler, applied, tick } = harness();
  scheduler.queue({ sessionId: "a", n: 1 });
  scheduler.cancel();
  for (let i = 0; i < 20; i += 1) tick();
  assert.equal(applied.length, 0);
});
