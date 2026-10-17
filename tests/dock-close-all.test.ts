import test from "node:test";
import assert from "node:assert/strict";
import { dockCloseAllPrompt, planDockCloseAll, type DockCloseCandidate } from "../src/lib/dock-close-all.ts";

const pane = (id: string, flags: Partial<DockCloseCandidate> = {}): DockCloseCandidate => ({ id, dirty: false, saving: false, ...flags });

test("closes every pane right to left and asks nothing when nothing is unsaved", () => {
  const plan = planDockCloseAll([pane("terminal"), pane("files"), pane("editor")]);
  assert.deepEqual(plan, { close: ["editor", "files", "terminal"], dirty: 0, skipped: 0 });
  assert.equal(dockCloseAllPrompt(plan), null);
});

test("unsaved editors are counted once for the whole batch", () => {
  const one = planDockCloseAll([pane("terminal"), pane("a", { dirty: true })]);
  assert.deepEqual(dockCloseAllPrompt(one), { key: "dock.closeAllDirtyOne", params: { count: 1 } });
  const two = planDockCloseAll([pane("a", { dirty: true }), pane("files"), pane("b", { dirty: true })]);
  assert.equal(two.close.length, 3);
  assert.deepEqual(dockCloseAllPrompt(two), { key: "dock.closeAllDirty", params: { count: 2 } });
});

test("a file that is still saving stays open, like a single close", () => {
  const plan = planDockCloseAll([pane("a", { dirty: true, saving: true }), pane("files")]);
  assert.deepEqual(plan, { close: ["files"], dirty: 0, skipped: 1 });
  assert.equal(dockCloseAllPrompt(plan), null);
});

test("an empty dock has nothing to close or confirm", () => {
  const plan = planDockCloseAll([]);
  assert.deepEqual(plan, { close: [], dirty: 0, skipped: 0 });
  assert.equal(dockCloseAllPrompt(plan), null);
});
