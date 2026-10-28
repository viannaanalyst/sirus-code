import assert from "node:assert/strict";
import { test } from "node:test";
import { composerFor, composerWithin, focusComposer, insertIntoComposer, registerComposer, type ComposerHandle } from "../src/lib/composer-focus.ts";

function fake(owner: string, options: { visible?: boolean; editable?: boolean; element?: unknown } = {}) {
  const calls: string[] = [];
  const handle: ComposerHandle = {
    owner,
    element: (options.element ?? null) as HTMLElement | null,
    focus: focusOptions => { calls.push(`focus:${focusOptions?.end ? "end" : "keep"}:${focusOptions?.preventScroll ? "still" : "scroll"}`); },
    insert: text => { calls.push(`insert:${text}`); },
    replaceRange: () => undefined,
    setCaret: () => undefined,
    text: () => "",
    selection: () => ({ start: 0, end: 0 }),
    editable: () => options.editable ?? true,
    visible: () => options.visible ?? true,
  };
  return { handle, calls };
}

test("a composer is found by its owner while mounted and gone after it unmounts", () => {
  const { handle, calls } = fake("session:a");
  assert.equal(focusComposer("session:a"), false);
  const unregister = registerComposer(handle);
  assert.equal(composerFor("session:a"), handle);
  assert.equal(focusComposer("session:a", { end: true, preventScroll: true }), true);
  assert.deepEqual(calls, ["focus:end:still"]);
  unregister();
  assert.equal(composerFor("session:a"), null);
  assert.equal(focusComposer("session:a"), false);
});

test("with two editors for one owner the visible one wins", () => {
  const hidden = fake("session:b", { visible: false });
  const shown = fake("session:b");
  const stops = [registerComposer(shown.handle), registerComposer(hidden.handle)];
  assert.equal(composerFor("session:b"), shown.handle);
  stops.forEach(stop => stop());
});

test("text goes in at the selection, and a disabled composer refuses it", () => {
  const open = fake("project:p");
  const locked = fake("project:q", { editable: false });
  const stops = [registerComposer(open.handle), registerComposer(locked.handle)];
  assert.equal(insertIntoComposer("project:p", "> quoted\n\n"), true);
  assert.deepEqual(open.calls, ["insert:> quoted\n\n"]);
  assert.equal(insertIntoComposer("project:q", "x"), false);
  assert.deepEqual(locked.calls, []);
  assert.equal(insertIntoComposer("project:none", "x"), false);
  stops.forEach(stop => stop());
});

test("a composer is found inside the pane that holds it", () => {
  const inside = { id: "inside" };
  const outside = { id: "outside" };
  const pane = { contains: (node: unknown) => node === inside } as unknown as Element;
  const a = fake("session:c", { element: inside });
  const b = fake("session:d", { element: outside });
  const stops = [registerComposer(a.handle), registerComposer(b.handle)];
  assert.equal(composerWithin(pane), a.handle);
  assert.equal(composerWithin(null), null);
  stops.forEach(stop => stop());
});
