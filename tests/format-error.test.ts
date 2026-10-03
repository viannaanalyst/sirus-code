import assert from "node:assert/strict";
import test from "node:test";
import { formatUnknownError, isResizeObserverDeliveryWarning } from "../src/lib/format-error";

test("native ResizeObserver delivery notices are separated from application failures", () => {
  const message = "ResizeObserver loop completed with undelivered notifications.";
  assert.equal(isResizeObserverDeliveryWarning({ message, error: null }), true);
  assert.equal(isResizeObserverDeliveryWarning({ message, error: undefined }), true);
  assert.equal(isResizeObserverDeliveryWarning({ message: "ResizeObserver loop limit exceeded", error: null }), true);

  // A thrown application error, even with the same text, must stay visible.
  const failure = new Error(message);
  assert.equal(isResizeObserverDeliveryWarning({ message, error: failure }), false);
  assert.equal(formatUnknownError(failure), message);
  for (const other of ["Script error.", "ResizeObserver is not defined", "ResizeObserver callback failed", `${message} while saving settings`]) {
    assert.equal(isResizeObserverDeliveryWarning({ message: other, error: null }), false);
    assert.equal(formatUnknownError(other), other);
  }
});
