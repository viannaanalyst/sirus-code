import { test } from "node:test";
import assert from "node:assert/strict";
import { moveRailItem, railOrder, visibleRail } from "../src/lib/rail.ts";

test("rail order keeps saved items, drops unknown and retired ones and appends new items", () => {
  assert.deepEqual(railOrder(["pulls", "home", "bogus", "automations", "pulls"]), ["pulls", "home", "inbox", "kanban", "tasks", "archived"]);
});

test("hidden items disappear unless current, and Home cannot be hidden", () => {
  const shown = visibleRail([], ["home", "tasks", "pulls"], "pulls");
  assert.ok(shown.includes("home") && shown.includes("pulls") && !shown.includes("tasks"));
});

test("moving an item reorders the list", () => {
  assert.deepEqual(moveRailItem(railOrder([]), "pulls", 0).slice(0, 3), ["pulls", "home", "inbox"]);
});
