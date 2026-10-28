import assert from "node:assert/strict";
import { test } from "node:test";
import { AvatarScheduler, BLINK_EVERY_MS, BLINK_FOR_MS, WORKING_TICK_MS, type AvatarTarget, type SchedulerEnv } from "../src/lib/avatar-scheduler.ts";
import type { AvatarPose, AvatarState } from "../src/lib/project-avatar.ts";

/** A hand-turned clock, window and pointer, so the scheduler runs without a browser. */
function fakeEnv() {
  let now = 0, nextId = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const state = { active: true, motion: true };
  let onChange: (() => void) | null = null;
  let onMove: ((x: number, y: number) => void) | null = null;
  const env: SchedulerEnv = {
    setTimeout: (run, ms) => { const id = nextId++; timers.set(id, { at: now + ms, run }); return id; },
    clearTimeout: (id) => { timers.delete(id as number); },
    random: () => 0,
    active: () => state.active,
    motion: () => state.motion,
    watch: (change) => { onChange = change; return () => { onChange = null; }; },
    pointer: (move) => { onMove = move; return () => { onMove = null; }; },
  };
  return {
    env, state,
    get timers() { return timers.size; },
    get watching() { return onChange !== null; },
    get pointerListening() { return onMove !== null; },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); now = due[1].at; due[1].run();
      }
      now = end;
    },
    change() { onChange?.(); },
    move(x: number, y: number) { onMove?.(x, y); },
  };
}

function target(state: AvatarState, seed = 0, at = { x: 100, y: 100 }) {
  const poses: AvatarPose[] = [];
  const value: AvatarTarget & { poses: AvatarPose[]; state: AvatarState } = { state, seed, poses, paint: (pose) => { poses.push(pose); }, center: () => at };
  return value;
}

test("nothing runs while no avatar is on screen", () => {
  const clock = fakeEnv();
  const scheduler = new AvatarScheduler(clock.env);
  const a = target("working"), b = target("idle");
  scheduler.register(a); scheduler.register(b);
  assert.equal(clock.timers, 0);
  assert.equal(clock.pointerListening, false);
  assert.equal(scheduler.running, false);
  clock.advance(60_000);
  assert.equal(a.poses.length, 1, "only the first paint");
});

test("one shared timer ticks about five times a second, and only for avatars working on screen", () => {
  const clock = fakeEnv();
  const scheduler = new AvatarScheduler(clock.env);
  const crowd = Array.from({ length: 30 }, () => target("working"));
  for (const avatar of crowd) scheduler.register(avatar, true);
  assert.equal(clock.timers, 1, "thirty avatars, one timer");
  clock.advance(1000);
  assert.equal(crowd[0]!.poses.length - 1, Math.floor(1000 / WORKING_TICK_MS));
  assert.ok(WORKING_TICK_MS >= 166 && WORKING_TICK_MS <= 250, "between 4 and 6 fps");
  assert.deepEqual(new Set(crowd[0]!.poses.map((pose) => pose.bob)), new Set([false, true]));
  for (const avatar of crowd) scheduler.setVisible(avatar, false);
  assert.equal(clock.timers, 0, "off screen, the timer stops");
});

test("a state change draws at once and moves between the timers", () => {
  const clock = fakeEnv();
  const scheduler = new AvatarScheduler(clock.env);
  const avatar = target("idle");
  scheduler.register(avatar, true);
  assert.equal(clock.timers, 1, "the blink timer");
  avatar.state = "working";
  scheduler.update(avatar);
  assert.equal(avatar.poses.at(-1)?.state, "working");
  clock.advance(WORKING_TICK_MS);
  assert.equal(avatar.poses.length, 3);
  avatar.state = "waiting";
  scheduler.update(avatar);
  assert.equal(avatar.poses.at(-1)?.state, "waiting");
  assert.equal(clock.timers, 0, "a waiting avatar is still: no timer, no pointer");
  assert.equal(clock.pointerListening, false);
});

test("idle avatars blink a few at a time and open their eyes again", () => {
  const clock = fakeEnv();
  const scheduler = new AvatarScheduler(clock.env);
  const crowd = Array.from({ length: 6 }, (_, seed) => target("idle", seed));
  for (const avatar of crowd) scheduler.register(avatar, true);
  clock.advance(BLINK_EVERY_MS[0] + 1);
  const blinking = crowd.filter((avatar) => avatar.poses.at(-1)?.blink);
  assert.equal(blinking.length, 2, "one avatar in three per round");
  clock.advance(BLINK_FOR_MS + 1);
  assert.ok(crowd.every((avatar) => !avatar.poses.at(-1)?.blink), "eyes open again");
  clock.advance(BLINK_EVERY_MS[1] * 3);
  assert.ok(crowd.every((avatar) => avatar.poses.some((pose) => pose.blink)), "everyone blinks within a few rounds");
});

test("the pointer is listened to only while idle avatars are on screen, and only changed gazes repaint", () => {
  const clock = fakeEnv();
  const scheduler = new AvatarScheduler(clock.env);
  const near = target("idle", 0, { x: 100, y: 100 }), far = target("idle", 1, { x: 100, y: 900 });
  scheduler.register(near, true); scheduler.register(far, true);
  assert.equal(clock.pointerListening, true);
  const before = [near.poses.length, far.poses.length];
  clock.move(200, 100);
  assert.equal(near.poses.length, before[0]! + 1);
  assert.equal(near.poses.at(-1)?.gaze, 1);
  assert.equal(far.poses.length, before[1], "out of reach: no repaint");
  clock.move(210, 100);
  assert.equal(near.poses.length, before[0]! + 1, "same gaze: no repaint");
  clock.move(-50, 100);
  assert.equal(near.poses.at(-1)?.gaze, -1);
  scheduler.setVisible(near, false); scheduler.setVisible(far, false);
  assert.equal(clock.pointerListening, false);
});

test("a hidden or unfocused window stops everything", () => {
  const clock = fakeEnv();
  const scheduler = new AvatarScheduler(clock.env);
  const worker = target("working"), idler = target("idle");
  scheduler.register(worker, true); scheduler.register(idler, true);
  assert.ok(clock.timers >= 2 && clock.pointerListening);
  clock.state.active = false;
  clock.change();
  assert.equal(clock.timers, 0);
  assert.equal(clock.pointerListening, false);
  const drawn = worker.poses.length;
  clock.advance(10_000);
  assert.equal(worker.poses.length, drawn);
  clock.state.active = true;
  clock.change();
  assert.ok(clock.timers >= 2);
});

test("with animations off every avatar settles on one static frame and nothing runs", () => {
  const clock = fakeEnv();
  clock.state.motion = false;
  const scheduler = new AvatarScheduler(clock.env);
  const worker = target("working"), idler = target("idle"), waiter = target("waiting");
  for (const avatar of [worker, idler, waiter]) scheduler.register(avatar, true);
  assert.equal(clock.timers, 0);
  assert.equal(clock.pointerListening, false);
  clock.advance(10_000);
  clock.move(500, 500);
  assert.deepEqual(worker.poses.at(-1), { state: "working", blink: false, gaze: 0, bob: false, talk: false });
  assert.equal(idler.poses.at(-1)?.blink, false);
  assert.equal(waiter.poses.at(-1)?.state, "waiting");
});

test("unregistering the last avatar stops watching the window", () => {
  const clock = fakeEnv();
  const scheduler = new AvatarScheduler(clock.env);
  const avatar = target("working");
  const leave = scheduler.register(avatar, true);
  assert.ok(clock.watching && clock.timers === 1);
  leave();
  assert.equal(clock.watching, false);
  assert.equal(clock.timers, 0);
  assert.equal(scheduler.size, 0);
});
