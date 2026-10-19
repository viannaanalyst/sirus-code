import { test } from "node:test";
import assert from "node:assert/strict";
import { createToolOutputCache, formatOutputSize, hasStoredOutput, toolOutputKey } from "../src/lib/tool-output.ts";

test("only rows with a stored size have output stored apart", () => {
  assert.equal(hasStoredOutput({}), false);
  assert.equal(hasStoredOutput({ outputBytes: 0 }), false);
  assert.equal(hasStoredOutput({ outputBytes: 2048 }), true);
});

test("sizes read short", () => {
  assert.equal(formatOutputSize(980), "980 B");
  assert.equal(formatOutputSize(3000), "3 KB");
  assert.equal(formatOutputSize(48 * 1024), "48 KB");
  assert.equal(formatOutputSize(1.25 * 1024 * 1024), "1.3 MB");
  assert.equal(formatOutputSize(Number.NaN), "0 B");
});

test("row keys never collide across sessions and messages", () => {
  assert.notEqual(toolOutputKey("a", "bc", "d"), toolOutputKey("ab", "c", "d"));
});

test("the cache fetches a row once, keeps the most recent rows and retries a failure", async () => {
  const cache = createToolOutputCache(2);
  let calls = 0;
  const fetch = (text: string) => () => { calls += 1; return Promise.resolve(text); };
  const [one, again] = await Promise.all([cache.load("a", fetch("A")), cache.load("a", fetch("A"))]);
  assert.equal(one, "A"); assert.equal(again, "A"); assert.equal(calls, 1);
  assert.equal(await cache.load("a", fetch("other")), "A");
  await cache.load("b", fetch("B"));
  cache.get("a");
  await cache.load("c", fetch("C"));
  assert.equal(cache.size(), 2);
  assert.equal(cache.get("b"), undefined, "the least recently used row goes");
  assert.equal(cache.get("a"), "A");
  await assert.rejects(cache.load("d", () => Promise.reject(new Error("gone"))));
  assert.equal(await cache.load("d", fetch("D")), "D");
});
