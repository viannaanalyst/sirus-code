import { test } from "node:test";
import assert from "node:assert/strict";
import { fileList, undoBlockSession, undoBlockText } from "../src/lib/undo-block";
import type { UndoBlock } from "../src/client/types";

const t = (key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ""}`;

test("each refusal maps to its own message with shortened ids and named sessions", () => {
  const head: UndoBlock = { kind: "headMoved", was: "1234567890", now: "abcdefabcdef" };
  assert.equal(undoBlockText(head, t), 'undo.block.headMoved{"was":"1234567","now":"abcdefa"}');
  const running: UndoBlock = { kind: "otherSession", sessionId: "s2", title: "Fix tests", running: true, files: [] };
  assert.equal(undoBlockText(running, t), 'undo.block.running{"title":"Fix tests"}');
  const unkept: UndoBlock = { kind: "otherSession", sessionId: "s2", title: "Fix tests", running: false, files: ["a.ts", "b.ts", "c.ts"] };
  assert.match(undoBlockText(unkept, t), /^undo\.block\.unkept/);
  assert.match(undoBlockText({ kind: "changedAgain", files: ["a.ts"], laterTurn: true }, t), /^undo\.block\.laterTurn/);
  assert.match(undoBlockText({ kind: "changedAgain", files: ["a.ts"], laterTurn: false }, t), /^undo\.block\.edited/);
});

test("file lists name one file, count the rest, and never print an empty list", () => {
  assert.equal(fileList(["a.ts"], t), "a.ts");
  assert.equal(fileList(["a.ts", "b.ts", "c.ts"], t), 'undo.block.andMore{"first":"a.ts","count":2}');
  assert.equal(fileList([], t), "undo.block.someFiles");
});

test("only another session offers to be opened", () => {
  assert.equal(undoBlockSession({ kind: "otherSession", sessionId: "s2", title: "x", running: true, files: [] }), "s2");
  assert.equal(undoBlockSession({ kind: "headMoved", was: "a", now: "b" }), null);
  assert.equal(undoBlockSession(null), null);
});
