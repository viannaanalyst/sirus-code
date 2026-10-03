import { test } from "node:test";
import assert from "node:assert/strict";
import { settingsEscapeAction, settingsViewDirection } from "../src/lib/settings-navigation.ts";

test("Settings capture-phase Escape protects shortcut recording before dismissal", () => {
  assert.equal(settingsEscapeAction(true), "recording");
  assert.equal(settingsEscapeAction(false), "close");
});

test("Settings content enters from the direction of travel through the menu", () => {
  assert.equal(settingsViewDirection("general", "terminal"), 1, "down the menu rises");
  assert.equal(settingsViewDirection("terminal", "general"), -1, "up the menu descends");
});
