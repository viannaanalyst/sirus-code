import { describe, expect, it } from "vitest";

import type { GhosttyCell, GhosttyColor, GhosttyRow, GhosttySnapshot } from "./core";
import { renderGhosttySnapshot } from "./renderer";

const BACKGROUND: GhosttyColor = { r: 12, g: 12, b: 12 };
const FOREGROUND: GhosttyColor = { r: 212, g: 212, b: 212 };
const REVERSE: GhosttyColor = FOREGROUND;

function cell(text: string, background: GhosttyColor = BACKGROUND): GhosttyCell {
  return {
    text,
    wide: 0,
    foreground: FOREGROUND,
    background,
    bold: false,
    italic: false,
    invisible: false,
    strikethrough: false,
    overline: false,
    underline: false,
    selected: false,
  };
}

function snapshot(cursorStyle: number): GhosttySnapshot {
  const row: GhosttyRow = {
    cells: [cell("a"), cell("b", REVERSE)],
    text: "ab",
    isWrapContinuation: false,
    wrapsToNext: false,
  };
  return {
    cols: 2,
    rows: 1,
    foreground: FOREGROUND,
    background: BACKGROUND,
    cursor: FOREGROUND,
    cursorX: 0,
    cursorY: 0,
    cursorVisible: true,
    cursorBlinking: false,
    cursorStyle,
    dirtyRows: new Set([0]),
    rowData: [row],
  };
}

function recordingContext() {
  const calls: Array<{ op: string; args: unknown[]; fill: string }> = [];
  let fillStyle = "";
  const record =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args, fill: fillStyle });
    };
  const context = {
    canvas: { width: 100, height: 40 },
    set fillStyle(value: string) {
      fillStyle = value;
    },
    get fillStyle() {
      return fillStyle;
    },
    strokeStyle: "",
    textBaseline: "",
    font: "",
    save: record("save"),
    restore: record("restore"),
    resetTransform: record("resetTransform"),
    beginPath: record("beginPath"),
    rect: record("rect"),
    clip: record("clip"),
    clearRect: record("clearRect"),
    fillRect: record("fillRect"),
    strokeRect: record("strokeRect"),
    fillText: record("fillText"),
  };
  return { context: context as unknown as CanvasRenderingContext2D, calls };
}

const METRICS = { width: 8, height: 16, baseline: 12 };

function render(options: { transparentBackground?: boolean; cursorStyle?: 0 | 1 | 2; snapshotStyle?: number }) {
  const { context, calls } = recordingContext();
  renderGhosttySnapshot({
    context,
    snapshot: snapshot(options.snapshotStyle ?? 1),
    metrics: METRICS,
    fontSize: 12,
    fontFamily: "monospace",
    padding: 4,
    forceFull: true,
    cursorOn: true,
    ...(options.transparentBackground !== undefined ? { transparentBackground: options.transparentBackground } : {}),
    ...(options.cursorStyle !== undefined ? { cursorStyle: options.cursorStyle } : {}),
  });
  return calls;
}

describe("renderGhosttySnapshot glass", () => {
  it("paints the theme background when opaque", () => {
    const calls = render({});
    expect(calls.some((call) => call.op === "clearRect")).toBe(false);
    expect(calls.some((call) => call.op === "fillRect" && call.fill === "rgb(12, 12, 12)")).toBe(true);
  });

  it("clears default-background cells but keeps reverse video opaque on window glass", () => {
    const calls = render({ transparentBackground: true });
    expect(calls.filter((call) => call.op === "clearRect").length).toBe(2);
    expect(calls.some((call) => call.op === "fillRect" && call.fill === "rgb(12, 12, 12)")).toBe(false);
    // The reversed cell paints the foreground color as its background, never transparent or black.
    expect(calls.some((call) => call.op === "fillRect" && call.fill === "rgb(212, 212, 212)")).toBe(true);
  });
});

describe("renderGhosttySnapshot cursor shape", () => {
  const fills = (calls: ReturnType<typeof render>) => calls.filter((call) => call.op === "fillRect").map((call) => call.args);

  it("uses the user's shape when the program keeps the default block", () => {
    expect(fills(render({ cursorStyle: 0 }))).toContainEqual([4, 4, 2, 16]);
    expect(fills(render({ cursorStyle: 2 }))).toContainEqual([4, 18, 8, 2]);
    expect(fills(render({ cursorStyle: 0 }))).not.toContainEqual([4, 4, 8, 16]);
  });

  it("keeps a shape the program chose itself", () => {
    expect(fills(render({ cursorStyle: 0, snapshotStyle: 2 }))).toContainEqual([4, 18, 8, 2]);
  });
});
