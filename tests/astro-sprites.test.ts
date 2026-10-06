import assert from "node:assert/strict";
import test from "node:test";
import { astroActivity } from "../src/lib/astro-activity.ts";
import { astroSprite, SPRITE_SIZE, spritePalette } from "../src/lib/astro-sprites.ts";
import { ASTRO_ICONS } from "../src/lib/astro-art.ts";

test("every Astro sprite is 12×12 in both frames, outlined, and uses palette letters", () => {
  const palette = spritePalette("#8c9bff");
  for (const icon of ASTRO_ICONS) {
    for (const frame of [0, 1]) {
      const rows = astroSprite(icon, frame);
      assert.equal(rows.length, SPRITE_SIZE, icon);
      for (const row of rows) {
        assert.equal(row.length, SPRITE_SIZE, icon);
        for (const letter of row) assert.ok(letter === "." || letter in palette, `${icon}: ${letter}`);
      }
      assert.ok(rows.join("").includes("o"), `${icon} has an outline`);
    }
    assert.notDeepEqual(astroSprite(icon, 0), astroSprite(icon, 1), `${icon} animates`);
  }
});

test("an Astro waits for the person before it reports working", () => {
  const astro = { id: "a", sessionId: "c" };
  assert.equal(astroActivity(astro, [{ id: "c", status: "completed" }]), "idle");
  assert.equal(astroActivity(astro, [{ id: "c", status: "running" }]), "working");
  assert.equal(astroActivity(astro, [{ id: "s", status: "waiting", delegation: { astroId: "a", batch: "b", settled: false } }, { id: "c", status: "running" }]), "needs-you");
  assert.equal(astroActivity(astro, [{ id: "s", status: "running", delegation: { astroId: "other", batch: "b", settled: false } }]), "idle");
});
