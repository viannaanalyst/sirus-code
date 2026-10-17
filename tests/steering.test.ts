import { test } from "node:test";
import assert from "node:assert/strict";
import { canSteer, compactingTurn } from "../src/lib/steering.ts";

test("a running /compact takes no instructions; other running turns do", () => {
  assert.equal(canSteer("claude", "running"), true);
  assert.equal(canSteer("opencode", "running"), false);
  assert.equal(compactingTurn([{ role: "user", content: " /compact " }, { role: "agent", content: "" }]), true);
  assert.equal(compactingTurn([{ role: "user", content: "/compact" }, { role: "user", content: "fix it" }]), false);
  assert.equal(compactingTurn([{ role: "user", content: "/compact now" }]), false);
  assert.equal(compactingTurn(undefined), false);
});
