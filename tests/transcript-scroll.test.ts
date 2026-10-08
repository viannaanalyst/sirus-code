import { test } from "node:test";
import assert from "node:assert/strict";
import { anchoredScrollTop, createTranscriptScroll, estimateMessageHeight, firstVisibleRow, messageSizeStyle } from "../src/lib/transcript-scroll.ts";

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
