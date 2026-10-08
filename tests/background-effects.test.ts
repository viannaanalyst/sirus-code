import { test } from "node:test";
import assert from "node:assert/strict";
import { asciiChar, createBlobUrlCache, dataUrlToBlob, ditherChannel, hazeTone, luminance } from "../src/lib/background-effects.ts";

test("background effects map light to dither levels and characters", () => {
  assert.equal(ditherChannel(0, 0, 0), 0);
  assert.equal(ditherChannel(255, 3, 3), 255);
  // A mid grey becomes a mix of neighbouring levels across the Bayer cell.
  const levels = new Set(Array.from({ length: 16 }, (_, index) => ditherChannel(128, index % 4, Math.floor(index / 4))));
  assert.ok(levels.size >= 2 && [...levels].every((value) => value === 85 || value === 170));
  assert.equal(asciiChar(0), " ");
  assert.equal(asciiChar(1), "@");
  assert.ok(Math.abs(luminance(255, 255, 255) - 1) < 1e-9);
});

test("haze tone matches CSS saturate(1.2) brightness(1.08)", () => {
  // Greys keep their hue and only brighten.
  assert.deepEqual(hazeTone(100, 100, 100), [108, 108, 108]);
  assert.deepEqual(hazeTone(255, 255, 255), [255, 255, 255]);
  const [r, g, b] = hazeTone(200, 100, 50);
  assert.ok(r > 216 && g < 108 && b < 54, "colours move away from grey");
});

test("data URLs decode to blobs with their type", async () => {
  const blob = dataUrlToBlob(`data:image/jpeg;base64,${Buffer.from("hello").toString("base64")}`);
  assert.equal(blob.type, "image/jpeg");
  assert.equal(await blob.text(), "hello");
  assert.equal(await dataUrlToBlob("data:text/plain,a%20b").text(), "a b");
});

test("the background cache keeps two blob URLs and revokes the ones it drops", async () => {
  const revoked: string[] = [];
  const cache = createBlobUrlCache(2, (url) => revoked.push(url));
  let made = 0;
  const make = (url: string) => () => { made += 1; return Promise.resolve(url); };
  await cache.get("a", make("blob:a"));
  await cache.get("b", make("blob:b"));
  assert.equal(await cache.get("a", make("blob:a2")), "blob:a", "a hit is reused");
  await cache.get("c", make("blob:c"));
  await Promise.resolve();
  assert.deepEqual(revoked, ["blob:b"], "the least recently used entry is revoked");
  assert.equal(made, 3);
  cache.clear();
  await Promise.resolve();
  assert.deepEqual(revoked.sort(), ["blob:a", "blob:b", "blob:c"]);
  assert.equal(cache.size, 0);
  await assert.rejects(cache.get("x", () => Promise.reject(new Error("bad"))));
  assert.equal(cache.size, 0, "failures are not cached");
});
