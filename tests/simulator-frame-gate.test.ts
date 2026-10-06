import { test } from "node:test";
import assert from "node:assert/strict";
import { createFrameGateState, stepFrameGate } from "../src/components/simulator/frame-gate.ts";

const udid = "7692CA5A-48A0-4802-A848-D454D5AFE06F";
const frame = (sequence: number, options: { config?: boolean; keyframe?: boolean; udid?: string } = {}) => ({
  udid: options.udid ?? udid,
  sequence,
  config: options.config ?? false,
  keyframe: options.keyframe ?? false,
});

test("waits for codec config and a keyframe before decoding", () => {
  let state = createFrameGateState();
  let step = stepFrameGate(state, frame(1), udid);
  assert.equal(step.action.kind, "drop");
  state = step.state;

  step = stepFrameGate(state, frame(2, { config: true }), udid);
  assert.equal(step.action.kind, "configure");
  state = step.state;

  step = stepFrameGate(state, frame(3), udid);
  assert.equal(step.action.kind, "drop");
  state = step.state;

  step = stepFrameGate(state, frame(4, { keyframe: true }), udid);
  assert.deepEqual(step.action, { kind: "decode", keyframe: true });
  assert.equal(step.state.phase, "streaming");
});

test("requests a fresh keyframe after a lost delta and resumes only at a keyframe", () => {
  let state = stepFrameGate(createFrameGateState(), frame(10, { config: true }), udid).state;
  state = stepFrameGate(state, frame(11, { keyframe: true }), udid).state;

  let step = stepFrameGate(state, frame(13), udid);
  assert.equal(step.action.kind, "drop");
  assert.equal(step.requestKeyframe, true);
  state = step.state;

  step = stepFrameGate(state, frame(14), udid);
  assert.equal(step.action.kind, "drop");
  assert.equal(step.requestKeyframe, false);
  state = step.state;

  step = stepFrameGate(state, frame(15, { keyframe: true }), udid);
  assert.deepEqual(step.action, { kind: "decode", keyframe: true });
});

test("accepts sequence wrap and rejects duplicates, stale frames, and other devices", () => {
  let state = stepFrameGate(createFrameGateState(), frame(0xffff_fffe, { config: true }), udid).state;
  state = stepFrameGate(state, frame(0xffff_ffff, { keyframe: true }), udid).state;
  let step = stepFrameGate(state, frame(0), udid);
  assert.deepEqual(step.action, { kind: "decode", keyframe: false });
  state = step.state;

  step = stepFrameGate(state, frame(0), udid);
  assert.equal(step.action.kind, "drop");
  step = stepFrameGate(state, frame(1, { udid: "another-device" }), udid);
  assert.equal(step.action.kind, "ignore");
});
