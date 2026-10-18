import { test } from "node:test";
import assert from "node:assert/strict";
import type { AppUpdateStatus } from "../src/client/types.ts";
import { appUpdateDismissKey, appUpdatePercent, appUpdateSummary, appUpdateToast } from "../src/lib/app-update.ts";

const status = (extra: Partial<AppUpdateStatus>): AppUpdateStatus => ({
  currentVersion: "0.1.0", phase: "idle", version: null, notes: null, date: null,
  downloaded: 0, total: null, error: null, checkedAt: null, automatic: true, ...extra,
});

test("the toast offers an update until Later, follows the install and asks for the restart", () => {
  const available = status({ phase: "available", version: "0.1.1" });
  assert.equal(appUpdateToast(null, null, false), null);
  assert.equal(appUpdateToast(status({ phase: "upToDate" }), null, false), null);
  assert.equal(appUpdateToast(available, null, false), "available");
  assert.equal(appUpdateToast(available, appUpdateDismissKey(available, "available"), false), null);
  // Later for 0.1.1 does not hide 0.1.2.
  assert.equal(appUpdateToast(status({ phase: "available", version: "0.1.2" }), "0.1.1", false), "available");
  assert.equal(appUpdateToast(status({ phase: "downloading", version: "0.1.1" }), "0.1.1", true), "progress");
  const installed = status({ phase: "installed", version: "0.1.1" });
  assert.equal(appUpdateToast(installed, "0.1.1", true), "installed");
  assert.equal(appUpdateToast(installed, appUpdateDismissKey(installed, "installed"), true), null);
});

test("a failed check stays in Settings; a failed install shows in the toast", () => {
  const failed = status({ phase: "failed", error: "offline" });
  assert.equal(appUpdateToast(failed, null, false), null);
  assert.equal(appUpdateToast(failed, null, true), "failed");
  assert.equal(appUpdateToast(failed, appUpdateDismissKey(failed, "failed"), true), null);
});

test("progress and notes are shown briefly", () => {
  assert.equal(appUpdatePercent({ downloaded: 50, total: null }), null);
  assert.equal(appUpdatePercent({ downloaded: 50, total: 200 }), 25);
  assert.equal(appUpdatePercent({ downloaded: 300, total: 200 }), 100);
  assert.equal(appUpdateSummary(null), null);
  assert.equal(appUpdateSummary("- Faster   sidebar\n- Fix\n\nMore"), "Faster sidebar - Fix");
  assert.equal(appUpdateSummary("x".repeat(400), 20)?.length, 20);
});
