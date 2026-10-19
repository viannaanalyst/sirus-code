import { test } from "node:test";
import assert from "node:assert/strict";
import { GESTURE_WINDOW_MS, anchoredScrollTop, createTranscriptScroll, estimateMessageHeight, firstVisibleRow, messageSizeStyle, scrollVerdict } from "../src/lib/transcript-scroll.ts";

test("the anchor is the first row still visible below the viewport top", () => {
  const bottoms = [100, 260, 420, 600];
  const at = (index: number) => bottoms[index];
  assert.equal(firstVisibleRow(bottoms.length, at, 0), 0);
  assert.equal(firstVisibleRow(bottoms.length, at, 100), 1, "a row ending exactly at the top is no longer visible");
  assert.equal(firstVisibleRow(bottoms.length, at, 300), 2);
  assert.equal(firstVisibleRow(bottoms.length, at, 700), 4);
  assert.equal(firstVisibleRow(0, at, 0), 0);
});

test("anchoring scrolls by how far the anchor moved, ignoring sub-pixel drift", () => {
  // A placeholder above grew by 240 px: the anchor moved down, so the viewport follows it.
  assert.equal(anchoredScrollTop(1000, 12, 252), 1240);
  // A remembered size above shrank.
  assert.equal(anchoredScrollTop(1000, 12, -38), 950);
  assert.equal(anchoredScrollTop(1000, 12, 12.4), 1000);
  assert.equal(anchoredScrollTop(30, 0, -80), 0);
  assert.equal(anchoredScrollTop(500, 0, Number.NaN), 500);
});

test("height estimates grow with the text and stay bounded", () => {
  assert.equal(estimateMessageHeight("", "agent"), 48);
  assert.ok(estimateMessageHeight("one\ntwo\nthree\nfour", "agent") > estimateMessageHeight("one", "agent"));
  assert.ok(estimateMessageHeight("x".repeat(900), "agent") >= 240);
  assert.equal(estimateMessageHeight("line\n".repeat(10_000), "agent"), 1600);
  const message = { content: "hello", role: "agent" };
  assert.equal(messageSizeStyle(message), messageSizeStyle(message), "cached per message object");
  assert.equal(messageSizeStyle({ ...message, streaming: true }), undefined);
});

test("rows above the viewport changing height do not move what is being read", () => {
  const original = { resize: globalThis.ResizeObserver, request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame, style: globalThis.getComputedStyle };
  let resized: (entries: { target: unknown }[]) => void = () => {};
  const frames: FrameRequestCallback[] = [];
  class Observer {
    constructor(callback: (entries: { target: unknown }[]) => void) { resized = callback; }
    observe() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = Observer as unknown as typeof ResizeObserver;
  globalThis.requestAnimationFrame = callback => frames.push(callback);
  globalThis.cancelAnimationFrame = () => {};
  let styleReads = 0;
  globalThis.getComputedStyle = () => { styleReads++; return { paddingTop: "24px", paddingBottom: "24px" } as CSSStyleDeclaration; };
  const flush = () => { for (const callback of frames.splice(0)) callback(0); };
  try {
    // Rows are 100 px tall in content coordinates; the first can grow (a placeholder rendering).
    let firstHeight = 100;
    const viewport = { scrollTop: 0, clientHeight: 300, scrollHeight: 2000, getBoundingClientRect: () => ({ top: 0 }) } as unknown as HTMLElement;
    const row = (index: number) => ({
      isConnected: true,
      getBoundingClientRect: () => {
        const top = (index ? firstHeight + (index - 1) * 100 : 0) - viewport.scrollTop;
        return { top, bottom: top + (index ? 100 : firstHeight) };
      },
    });
    const rows = Array.from({ length: 10 }, (_, index) => row(index));
    const content = { children: [{ children: rows.slice(0, 8) }, { children: rows.slice(8) }] } as unknown as HTMLElement;
    let minHeightWrites = 0, minHeight = "";
    const tail = { style: { get minHeight() { return minHeight; }, set minHeight(value: string) { minHeightWrites++; minHeight = value; } } } as unknown as HTMLElement;
    const following: boolean[] = [];
    const controller = createTranscriptScroll(viewport, content, tail, value => following.push(value));
    controller.update("latest");
    assert.equal(viewport.scrollTop, 2000, "following pins the end");
    // The user scrolls up to row 3 (content offset 350): it starts 50 px above the viewport top.
    controller.interact();
    viewport.scrollTop = 350;
    controller.scroll();
    assert.equal(following.at(-1), false);
    flush();
    // Row 0 renders 240 px taller; the content resize must keep row 3 where it was.
    firstHeight = 340;
    resized([{ target: content }]);
    assert.equal(viewport.scrollTop, 590);
    flush();
    assert.equal(viewport.scrollTop, 590, "layout does not snap back to the end");
    // A resize that does not move the anchor changes nothing.
    resized([{ target: content }]);
    assert.equal(viewport.scrollTop, 590);
    flush();
    assert.equal(styleReads, 1, "padding is read once until the viewport resizes");
    assert.equal(minHeightWrites, 1, "an unchanged reserve is not rewritten");
    // Following the end again turns anchoring off.
    controller.follow();
    firstHeight = 100;
    resized([{ target: content }]);
    assert.equal(viewport.scrollTop, 2000);
    // A programmatic jump anchors where it lands, not where the reader was.
    controller.detach();
    viewport.scrollTop = 150;
    flush();
    firstHeight = 160;
    resized([{ target: viewport }]);
    assert.equal(viewport.scrollTop, 210);
    flush();
    assert.equal(styleReads, 2, "a viewport resize rereads the padding");
    controller.dispose();
  } finally {
    globalThis.ResizeObserver = original.resize;
    globalThis.requestAnimationFrame = original.request;
    globalThis.cancelAnimationFrame = original.cancel;
    globalThis.getComputedStyle = original.style;
  }
});

test("following changes only on the reader's own direction", () => {
  const original = { resize: globalThis.ResizeObserver, request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame, style: globalThis.getComputedStyle };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} } as unknown as typeof ResizeObserver;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.getComputedStyle = () => ({ paddingTop: "0px", paddingBottom: "0px" }) as CSSStyleDeclaration;
  try {
    const viewport = { scrollTop: 0, clientHeight: 300, scrollHeight: 2000, getBoundingClientRect: () => ({ top: 0 }) } as unknown as HTMLElement;
    const content = { children: [] } as unknown as HTMLElement;
    const tail = { style: { minHeight: "" } } as unknown as HTMLElement;
    const following: boolean[] = [];
    const controller = createTranscriptScroll(viewport, content, tail, value => following.push(value));
    controller.update("latest");
    assert.equal(viewport.scrollTop, 2000);
    // A sideways or momentum-end step (no vertical direction) keeps following.
    controller.interact(0);
    assert.equal(following.at(-1), true);
    // A small step up releases following at once, before any frame can snap back.
    controller.interact(-3);
    assert.equal(following.at(-1), false);
    viewport.scrollTop = 1690;
    controller.scroll();
    // Reading: a small reversal down, still away from the end, does not resume following.
    viewport.scrollTop = 1680;
    controller.scroll();
    viewport.scrollTop = 1690;
    controller.scroll();
    assert.equal(following.at(-1), false);
    // Back at the very end moving down resumes it.
    viewport.scrollTop = 1699;
    controller.scroll();
    assert.equal(following.at(-1), true);
    // Content shrinking under the reader (no move of their own) never flips it.
    controller.scroll();
    assert.equal(following.at(-1), true);
    controller.dispose();
  } finally {
    globalThis.ResizeObserver = original.resize;
    globalThis.requestAnimationFrame = original.request;
    globalThis.cancelAnimationFrame = original.cancel;
    globalThis.getComputedStyle = original.style;
  }
});

test("only the reader's own scroll up stops following", () => {
  // Layout moving the position (the end shrinking, the viewport growing, text streamed in
  // before the event arrives) re-pins the end, however far it left it.
  assert.equal(scrollVerdict({ following: true, moved: -60, distance: 300, gesture: false }), "repin");
  assert.equal(scrollVerdict({ following: true, moved: 40, distance: 120, gesture: false }), "repin");
  assert.equal(scrollVerdict({ following: true, moved: -2, distance: 0, gesture: false }), "keep");
  // The reader moving up and away releases it; a small step up or down does not.
  assert.equal(scrollVerdict({ following: true, moved: -60, distance: 60, gesture: true }), "release");
  assert.equal(scrollVerdict({ following: true, moved: -20, distance: 20, gesture: true }), "keep");
  assert.equal(scrollVerdict({ following: true, moved: 30, distance: 200, gesture: true }), "keep");
  // Back at the very end moving down resumes it, whoever moved.
  assert.equal(scrollVerdict({ following: false, moved: 10, distance: 2, gesture: false }), "resume");
  assert.equal(scrollVerdict({ following: false, moved: 10, distance: 40, gesture: true }), "keep");
  assert.equal(scrollVerdict({ following: false, moved: -10, distance: 2, gesture: true }), "keep");
});

test("while streaming, layout never stops following and growth stays pinned", () => {
  const original = { resize: globalThis.ResizeObserver, request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame, style: globalThis.getComputedStyle, now: performance.now };
  let resized: (entries: { target: unknown }[]) => void = () => {};
  globalThis.ResizeObserver = class { constructor(callback: (entries: { target: unknown }[]) => void) { resized = callback; } observe() {} disconnect() {} } as unknown as typeof ResizeObserver;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.getComputedStyle = () => ({ paddingTop: "0px", paddingBottom: "0px" }) as CSSStyleDeclaration;
  let now = 1000;
  performance.now = () => now;
  try {
    let scrollHeight = 2000, clientHeight = 300, scrollTop = 0;
    // Like a browser, the position is clamped to the end.
    const viewport = {
      get scrollTop() { return scrollTop; }, set scrollTop(value: number) { scrollTop = Math.max(0, Math.min(value, scrollHeight - clientHeight)); },
      get scrollHeight() { return scrollHeight; }, get clientHeight() { return clientHeight; },
      getBoundingClientRect: () => ({ top: 0 }),
    } as unknown as HTMLElement;
    const tail = { style: { minHeight: "" } } as unknown as HTMLElement;
    const following: boolean[] = [];
    const controller = createTranscriptScroll(viewport, { children: [] } as unknown as HTMLElement, tail, value => following.push(value));
    controller.update("sent");
    assert.equal(scrollTop, 1700);
    now += 5000;
    // Streamed text grows the content: the end is pinned in the same frame, before paint.
    scrollHeight = 2400;
    resized([{ target: {} }]);
    assert.equal(scrollTop, 2100);
    // The pill above the composer goes away: the viewport grows and the position is clamped up;
    // a long Markdown block streams in before the scroll event arrives.
    clientHeight = 360;
    viewport.scrollTop = scrollTop;
    scrollHeight = 2600;
    controller.scroll();
    assert.equal(following.at(-1), true, "a layout move is not the reader's");
    assert.equal(scrollTop, 2240, "and the end is pinned again at once");
    // The reader's wheel step then scrolls up: that releases it.
    controller.interact(0);
    viewport.scrollTop = 2000;
    controller.scroll();
    assert.equal(following.at(-1), false);
    controller.follow();
    assert.equal(scrollTop, 2240);
    // Once the gesture is old, layout moves are layout again.
    now += GESTURE_WINDOW_MS + 1;
    viewport.scrollTop = 1900;
    controller.scroll();
    assert.equal(following.at(-1), true);
    assert.equal(scrollTop, 2240);
    // A held pointer (dragging a selection past the top) is the reader's for as long as it is held.
    controller.hold(true);
    now += GESTURE_WINDOW_MS * 4;
    viewport.scrollTop = 1900;
    controller.scroll();
    assert.equal(following.at(-1), false);
    controller.hold(false);
    controller.dispose();
  } finally {
    globalThis.ResizeObserver = original.resize;
    globalThis.requestAnimationFrame = original.request;
    globalThis.cancelAnimationFrame = original.cancel;
    globalThis.getComputedStyle = original.style;
    performance.now = original.now;
  }
});

test("just after a new turn, only a gesture stops following, not the page moving", () => {
  const original = { resize: globalThis.ResizeObserver, request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame, style: globalThis.getComputedStyle, now: performance.now };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} } as unknown as typeof ResizeObserver;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.getComputedStyle = () => ({ paddingTop: "0px", paddingBottom: "0px" }) as CSSStyleDeclaration;
  const now = 1000;
  performance.now = () => now;
  try {
    const viewport = { scrollTop: 0, clientHeight: 300, scrollHeight: 2000, getBoundingClientRect: () => ({ top: 0 }) } as unknown as HTMLElement;
    const tail = { style: { minHeight: "" } } as unknown as HTMLElement;
    const following: boolean[] = [];
    const controller = createTranscriptScroll(viewport, { children: [] } as unknown as HTMLElement, tail, value => following.push(value));
    // A gesture made just before sending does not count for the new turn.
    controller.interact(0);
    controller.update("sent");
    assert.equal(viewport.scrollTop, 2000);
    // The keyboard closes and the composer shrinks: the page scrolls up by itself.
    viewport.scrollTop = 1400;
    controller.scroll();
    assert.equal(following.at(-1), true);
    assert.equal(viewport.scrollTop, 2000, "the end is pinned again");
    // A finger moving the content down is the reader's own: following stops at once.
    controller.interact(-20);
    assert.equal(following.at(-1), false);
    controller.dispose();
  } finally {
    globalThis.ResizeObserver = original.resize;
    globalThis.requestAnimationFrame = original.request;
    globalThis.cancelAnimationFrame = original.cancel;
    globalThis.getComputedStyle = original.style;
    performance.now = original.now;
  }
});
