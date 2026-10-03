import { test } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "../src/client/types.ts";
import { deriveMessageTrail, observeMessageTrail, resolveMessageTrailPosition } from "../src/lib/message-trail.ts";

const message = (id: string, role: Message["role"], content: string): Message => ({ id, role, content, sessionId: "s", createdAt: "time", streaming: false });

test("topics use actual user requests and the last nonempty reply in each turn", () => {
  const items = deriveMessageTrail([
    message("system", "system", "Diagnostic"), message("orphan", "agent", "No user yet"),
    message("first", "user", "  Quero\n abrir  PDF "), message("preamble", "agent", "Vou conferir"),
    message("result", "agent", "Pronto\n no painel"), message("stderr", "system", "Ignore me"),
    message("empty", "agent", "  "), message("second", "user", "<script>literal</script>"),
  ]);
  assert.deepEqual(items, [
    { id: "first", ordinal: 1, preview: "Quero abrir PDF", responsePreview: "Pronto no painel" },
    { id: "second", ordinal: 2, preview: "<script>literal</script>", responsePreview: "" },
  ]);
});

test("streamed updates refresh bounded response previews without changing topic identities", () => {
  const user = message("request", "user", "Abrir o leitor");
  const reply = message("reply", "agent", "Começo");
  assert.equal(deriveMessageTrail([user, reply])[0].responsePreview, "Começo");
  const updated = deriveMessageTrail([user, { ...reply, content: "Resposta ".repeat(100_000), streaming: true }]);
  assert.equal(updated[0].id, user.id);
  assert.ok(updated[0].responsePreview.length <= 281);
  assert.ok(updated[0].responsePreview.endsWith("…"));
  assert.equal(deriveMessageTrail([]).length, 0);
});

test("the reading marker stays with its turn throughout a long reply", () => {
  const anchors = [{ id: "first", top: 20, bottom: 80 }, { id: "second", top: 2000, bottom: 2080 }, { id: "third", top: 2400, bottom: 2440 }];
  assert.deepEqual(resolveMessageTrailPosition(anchors, 0, 600), { currentId: "first", visibleIds: ["first"] });
  assert.deepEqual(resolveMessageTrailPosition(anchors, 1000, 1600), { currentId: "first", visibleIds: [] });
  assert.deepEqual(resolveMessageTrailPosition(anchors, 1999.5, 2500), { currentId: "second", visibleIds: ["second", "third"] });
  assert.equal(resolveMessageTrailPosition(anchors, 2600, 3000).currentId, "third");
  assert.deepEqual(resolveMessageTrailPosition([], 0, 100), { currentId: null, visibleIds: [] });
  assert.equal(resolveMessageTrailPosition(anchors, NaN, 100).currentId, null);
});

test("the latest reserved turn is current while its request sits at viewport top padding", () => {
  const anchors = [{ id: "previous", top: 0, bottom: 50 }, { id: "latest", top: 1000, bottom: 1050 }];
  assert.deepEqual(resolveMessageTrailPosition(anchors, 976, 1476, 24), { currentId: "latest", visibleIds: ["latest"] });
  // The reading inset must not hide a partially visible preceding request.
  assert.deepEqual(resolveMessageTrailPosition([{ id: "previous", top: 900, bottom: 990 }, anchors[1]], 976, 1476, 24), { currentId: "latest", visibleIds: ["previous", "latest"] });
});

test("scroll observation coalesces frames, caches geometry, responds to resize and cleans up", () => {
  const original = { resize: globalThis.ResizeObserver, request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame, style: globalThis.getComputedStyle };
  let resized = () => {}, scheduled: FrameRequestCallback | undefined, disconnected = false, canceled = false;
  const observed: Element[] = [];
  class Observer {
    constructor(callback: () => void) { resized = callback; }
    observe(node: Element) { observed.push(node); }
    disconnect() { disconnected = true; }
  }
  globalThis.ResizeObserver = Observer as unknown as typeof ResizeObserver;
  globalThis.requestAnimationFrame = callback => { assert.equal(scheduled, undefined); scheduled = callback; return 1; };
  globalThis.cancelAnimationFrame = () => { canceled = true; scheduled = undefined; };
  globalThis.getComputedStyle = () => ({ paddingTop: "24px" }) as CSSStyleDeclaration;
  try {
    const viewport = Object.assign(new EventTarget(), { scrollTop: 0, clientHeight: 300, getBoundingClientRect: () => ({ top: 100 }) }) as unknown as HTMLElement;
    const content = {} as HTMLElement;
    let reads = 0, secondTop = 1000;
    const node = (top: () => number) => ({ getBoundingClientRect: () => { reads++; return { top: 100 + top() - viewport.scrollTop, bottom: 150 + top() - viewport.scrollTop }; } }) as unknown as HTMLElement;
    const updates: string[] = [];
    const dispose = observeMessageTrail(viewport, content, ["first", "second"], new Map([["first", node(() => 0)], ["second", node(() => secondTop)]]), value => updates.push(value.currentId!));
    const flush = () => { const callback = scheduled; scheduled = undefined; callback?.(0); };
    flush();
    assert.deepEqual(observed, [viewport, content]);
    assert.deepEqual(updates, ["first"]);
    viewport.scrollTop = 976;
    viewport.dispatchEvent(new Event("scroll")); viewport.dispatchEvent(new Event("scroll"));
    flush();
    assert.deepEqual(updates, ["first", "second"]);
    assert.equal(reads, 2, "scrolling uses cached offsets instead of rereading every article");
    secondTop = 2000;
    resized(); flush();
    assert.equal(reads, 4);
    assert.deepEqual(updates, ["first", "second", "first"]);
    dispose();
    assert.ok(disconnected && canceled);
    viewport.dispatchEvent(new Event("scroll"));
    assert.equal(scheduled, undefined);
  } finally {
    globalThis.ResizeObserver = original.resize;
    globalThis.requestAnimationFrame = original.request;
    globalThis.cancelAnimationFrame = original.cancel;
    globalThis.getComputedStyle = original.style;
  }
});
