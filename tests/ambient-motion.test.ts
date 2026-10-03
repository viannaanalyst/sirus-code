import { test } from "node:test";
import assert from "node:assert/strict";

class FakeTarget {
  listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: () => void) { this.listeners.get(type)?.delete(listener); }
  fire(type: string) { for (const listener of this.listeners.get(type) ?? []) listener(); }
}

test("decorative loops pause on window blur, hidden documents and Settings coverage", async () => {
  const fakeWindow = new FakeTarget();
  // hasFocus reports false, as WKWebView can while the app mounts: focus events decide instead.
  const fakeDocument = Object.assign(new FakeTarget(), { hidden: false, hasFocus: () => false });
  Object.assign(globalThis, { window: fakeWindow, document: fakeDocument });
  try {
    const { ambientActive, setAmbientCovered, subscribeAmbient } = await import("../src/lib/ambient-motion.ts");
    let notified = 0;
    const unsubscribe = subscribeAmbient(() => { notified += 1; });
    assert.equal(ambientActive(), true);

    fakeWindow.fire("blur");
    assert.equal(ambientActive(), false);
    fakeWindow.fire("focus");
    assert.equal(ambientActive(), true);

    fakeDocument.hidden = true;
    fakeDocument.fire("visibilitychange");
    assert.equal(ambientActive(), false);
    fakeDocument.hidden = false;
    fakeDocument.fire("visibilitychange");

    setAmbientCovered(true);
    assert.equal(ambientActive(), false);
    setAmbientCovered(true);
    setAmbientCovered(false);
    assert.equal(ambientActive(), true);
    assert.equal(notified, 6, "a repeated coverage value does not notify again");

    unsubscribe();
    setAmbientCovered(true);
    assert.equal(notified, 6, "an unsubscribed loop is not notified");
    setAmbientCovered(false);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
  }
});
