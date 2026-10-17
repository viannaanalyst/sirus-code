import { test } from "node:test";
import assert from "node:assert/strict";
import { keepsNativeMenu } from "../src/lib/native-menu.ts";

const inside = (matches: boolean) => ({ closest: () => (matches ? {} : null) });

test("the native right-click menu stays only where it helps", () => {
  assert.equal(keepsNativeMenu(inside(false), ""), false);
  assert.equal(keepsNativeMenu(null, ""), false);
  assert.equal(keepsNativeMenu(inside(true), ""), true);
  assert.equal(keepsNativeMenu(inside(false), "copied words"), true);
  assert.equal(keepsNativeMenu(inside(false), "  \n"), false);
});
