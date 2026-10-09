import { test } from "node:test";
import assert from "node:assert/strict";
import { FRESH_MESSAGE_MS, isFreshMessage } from "../src/lib/fresh-message.ts";

test("only a message created a moment ago animates", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  assert.equal(isFreshMessage("2026-10-08T11:59:59.500Z", now), true);
  assert.equal(isFreshMessage(new Date(now - FRESH_MESSAGE_MS - 1).toISOString(), now), false);
  assert.equal(isFreshMessage("time", now), false);
});
