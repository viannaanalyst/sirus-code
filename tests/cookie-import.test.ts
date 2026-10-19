import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canReviewSelection,
  filterDomains,
  initialSelection,
  isFullDiskAccessError,
  selectedCookieCount,
  selectedDomains,
  toggleDomain,
} from "../src/lib/cookie-import.ts";
import type { CookieDomain } from "../src/client/types.ts";

const domains: CookieDomain[] = [
  { domain: "accounts.example.com", count: 4 },
  { domain: "example.com", count: 12 },
  { domain: "shop.test", count: 3 },
];

test("nothing is preselected, so the review stays closed until a domain is ticked", () => {
  const selected = initialSelection();
  assert.equal(selected.size, 0);
  assert.equal(canReviewSelection(selected), false);
  assert.deepEqual(selectedDomains(domains, selected), []);
  assert.equal(selectedCookieCount(domains, selected), 0);
});

test("ticking and unticking toggles one domain without mutating the previous selection", () => {
  const first = toggleDomain(initialSelection(), "example.com");
  assert.equal(canReviewSelection(first), true);
  const second = toggleDomain(first, "shop.test");
  assert.deepEqual([...first], ["example.com"], "the earlier selection is unchanged");
  assert.deepEqual([...second].sort(), ["example.com", "shop.test"]);
  assert.deepEqual([...toggleDomain(second, "example.com")], ["shop.test"]);
});

test("the consent step names the ticked domains in list order and counts their cookies", () => {
  const selected = new Set(["shop.test", "example.com"]);
  assert.deepEqual(selectedDomains(domains, selected), ["example.com", "shop.test"]);
  assert.equal(selectedCookieCount(domains, selected), 15);
});

test("the search filters by substring, ignoring case, and keeps everything when empty", () => {
  assert.deepEqual(filterDomains(domains, "  EXAMPLE "), [domains[0], domains[1]]);
  assert.equal(filterDomains(domains, "").length, 3);
  assert.deepEqual(filterDomains(domains, "nothing-here"), []);
});

test("only the back end's full_disk_access code is treated as the Safari permission case", () => {
  assert.equal(isFullDiskAccessError({ code: "full_disk_access", message: "x" }), true);
  assert.equal(isFullDiskAccessError({ code: "native", message: "x" }), false);
  assert.equal(isFullDiskAccessError(new Error("full_disk_access")), false);
  assert.equal(isFullDiskAccessError(null), false);
});
