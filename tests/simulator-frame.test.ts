import assert from "node:assert/strict";
import test from "node:test";
import { parseSimulatorFrame } from "../src/client/simulator-frame.ts";

function envelope(flags: number, udid: string, payload: number[]) {
  const id = new TextEncoder().encode(udid);
  const buffer = new ArrayBuffer(17 + id.length + payload.length);
  const view = new DataView(buffer);
  view.setUint16(0, 0x5346, true);
  view.setUint8(2, 1);
  view.setUint8(3, flags);
  view.setUint32(4, 42, true);
  view.setFloat64(8, 1234.5, true);
  view.setUint8(16, id.length);
  new Uint8Array(buffer, 17).set(id);
  new Uint8Array(buffer, 17 + id.length).set(payload);
  return buffer;
}

test("simulator envelopes parse into frames without copying the payload", () => {
  const frame = parseSimulatorFrame(envelope(3, "7997560A-87D6-47E3-A221-5078A0D241DF", [0, 0, 0, 1, 0x67]));
  assert.ok(frame);
  assert.equal(frame.udid, "7997560A-87D6-47E3-A221-5078A0D241DF");
  assert.equal(frame.sequence, 42);
  assert.equal(frame.timestampMs, 1234.5);
  assert.equal(frame.keyframe, true);
  assert.equal(frame.config, true);
  assert.deepEqual([...frame.data], [0, 0, 0, 1, 0x67]);
});

test("malformed simulator envelopes are rejected", () => {
  assert.equal(parseSimulatorFrame(new ArrayBuffer(8)), null);
  const wrongMagic = envelope(0, "x", [1]);
  new DataView(wrongMagic).setUint16(0, 0x1234, true);
  assert.equal(parseSimulatorFrame(wrongMagic), null);
  const truncated = envelope(0, "abc", []);
  new DataView(truncated).setUint8(16, 200);
  assert.equal(parseSimulatorFrame(truncated), null);
});
