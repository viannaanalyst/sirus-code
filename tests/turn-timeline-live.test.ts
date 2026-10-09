import { test } from "node:test";
import assert from "node:assert/strict";
import { liveFoldBoundary } from "../src/lib/turn-timeline.ts";

test("a running turn folds everything before its newest paragraph", () => {
  const text = (start: number) => ({ kind: "text" as const, start, end: start + 1 });
  const work = { kind: "work" as const, items: [] };
  assert.equal(liveFoldBoundary([text(0), work, text(5), work]), 2);
  assert.equal(liveFoldBoundary([text(0), work]), 0);
  assert.equal(liveFoldBoundary([]), 0);
});

test("each reply after a background subagent's marker stays visible (ADR-101)", async () => {
  const { foldBoundary, markerSentence, stepSentence, timelineParts } = await import("../src/lib/turn-timeline.ts");
  const { translate } = await import("../src/i18n/index.ts");
  type Item = Parameters<typeof timelineParts>[1][number];
  const row = (id: string, offset: number, extra: Partial<Item> = {}): Item => ({ id, kind: "tool", label: "", state: "completed", model: null, offset, ...extra });
  const marker = (id: string, label: string, offset: number, state: Item["state"] = "completed") => row(`done:${id}`, offset, { label, state, finishedTask: true });
  const content = "Launched.\n\nAudit A is in.\n\nAudit B failed.";
  const parts = timelineParts(content, [row("read", 0, { kind: "read", detail: "a.ts" }), row("task", 9, { kind: "agent", label: "A" }), marker("a", "Audit A", 11), marker("b", "Audit B", 27, "failed")]);
  const shape = parts.map((part) => part.kind === "text" ? `text:${content.slice(part.start, part.end).trim()}` : part.kind === "marker" ? `marker:${part.item.label}` : part.kind);
  assert.deepEqual(shape, ["work", "text:Launched.", "work", "marker:Audit A", "text:Audit A is in.", "marker:Audit B", "text:Audit B failed."]);
  // A finished turn folds only the work before its own answer; the answer, markers and replies stay.
  assert.equal(foldBoundary(parts), 1);
  // While it runs, the newest paragraph no longer folds the earlier replies away.
  assert.equal(liveFoldBoundary(parts), 1);
  // Without markers nothing changes: everything before the last text folds.
  const plain = timelineParts("One.\n\nTwo.", [row("r", 5)]);
  assert.equal(foldBoundary(plain), 2);
  assert.equal(liveFoldBoundary(plain), 2);
  // The answer before the launch work stays when a marker follows.
  assert.equal(foldBoundary(timelineParts("Go.\n\nDone.", [row("t", 3), marker("x", "X", 5)])), 0);
  const pt = (key: string, params?: Record<string, string | number>) => translate("pt-BR", key, params);
  const en = (key: string, params?: Record<string, string | number>) => translate("en", key, params);
  assert.equal(markerSentence({ label: "Auditoria", state: "completed" }, pt), "Subagente Auditoria concluído");
  assert.equal(markerSentence({ label: "Auditoria", state: "failed" }, pt), "Subagente Auditoria falhou");
  assert.equal(markerSentence({ label: "Auditoria", state: "stopped" }, pt), "Subagente Auditoria parado");
  assert.equal(markerSentence({ label: "Subagent", state: "completed" }, en), "Subagent finished");
  assert.equal(stepSentence(marker("a", "Audit A", 0), en), "Subagent Audit A finished");
});
