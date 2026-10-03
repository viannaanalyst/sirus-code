import { test } from "node:test";
import assert from "node:assert/strict";
import { createDraftWriter } from "../src/lib/draft-persistence.ts";
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };

test("draft saves serialize and coalesce superseded text without resurrecting a cleared draft", async () => {
  const first = deferred(); const writes: string[] = [];
  const writer = createDraftWriter(async (_key, value) => { writes.push(value); if (writes.length === 1) await first.promise; }, () => assert.fail("save should succeed"));
  const pending = writer.write("session:one", "old");
  writer.write("session:one", "intermediate");
  writer.write("session:one", "");
  first.resolve(); await pending;
  assert.deepEqual(writes, ["old", ""]);
});

test("forgetting a removed session discards queued saves and stale errors", async () => {
  const first = deferred(); const writes: string[] = []; const errors: unknown[] = [];
  const writer = createDraftWriter(async (_key, value) => { writes.push(value); await first.promise; throw new Error("removed session"); }, (error) => errors.push(error));
  const pending = writer.write("session:deleted", "old");
  writer.write("session:deleted", "new");
  writer.forget("session:deleted"); first.resolve(); await pending;
  assert.deepEqual(writes, ["old"]); assert.deepEqual(errors, []);
});
