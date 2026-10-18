import { test } from "node:test";
import assert from "node:assert/strict";
import { forgetUnanswered, rememberUnanswered, retryIdFor } from "../src/lib/unanswered-sends.ts";
import { isUnansweredSend } from "../src/client/remote-transport.ts";
import { formatUnknownError } from "../src/lib/format-error.ts";

test("resending the same text after an unanswered send reuses its request id", () => {
  rememberUnanswered("session:a", "fix the build", "id-1");
  assert.equal(retryIdFor("session:a", "fix the build"), "id-1");
  assert.equal(retryIdFor("session:a", "fix the tests"), undefined);
  assert.equal(retryIdFor("session:b", "fix the build"), undefined);
  forgetUnanswered("session:a");
  assert.equal(retryIdFor("session:a", "fix the build"), undefined);
});

test("only a timeout or a dropped connection counts as unanswered", () => {
  assert.equal(isUnansweredSend(formatUnknownError(new Error("The Mac did not answer in time."))), true);
  assert.equal(isUnansweredSend(formatUnknownError(new Error("The connection to the Mac was lost."))), true);
  assert.equal(isUnansweredSend("Cannot reach the Mac. Check that Sirus is open and Tailscale is on."), false);
  assert.equal(isUnansweredSend("Prompt is empty"), false);
});
