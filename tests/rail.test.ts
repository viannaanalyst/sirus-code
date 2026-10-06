import { test } from "node:test";
import assert from "node:assert/strict";
import { moveRailItem, railOrder, visibleRail } from "../src/lib/rail.ts";

test("rail order keeps saved items, drops unknown ones and appends new items", () => {
  assert.deepEqual(railOrder(["pulls", "home", "bogus", "pulls"]), ["pulls", "home", "inbox", "kanban", "tasks", "archived", "automations"]);
});

test("hidden items disappear unless current, and Home cannot be hidden", () => {
  const shown = visibleRail([], ["home", "tasks", "pulls"], "pulls");
  assert.ok(shown.includes("home") && shown.includes("pulls") && !shown.includes("tasks"));
});

test("moving an item reorders the list", () => {
  assert.deepEqual(moveRailItem(railOrder([]), "automations", 0).slice(0, 3), ["automations", "home", "inbox"]);
});
