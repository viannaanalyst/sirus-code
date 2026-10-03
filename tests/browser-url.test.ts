import { test } from "node:test";
import assert from "node:assert/strict";
import { browserAddressDisplayValue, normalizeBrowserAddressInput } from "../src/lib/browser-url.ts";

test("address input keeps explicit http(s) URLs and blank documents", () => {
  assert.equal(normalizeBrowserAddressInput("https://example.com/a?b=1#c"), "https://example.com/a?b=1#c");
  assert.equal(normalizeBrowserAddressInput("  http://localhost:1420/  "), "http://localhost:1420/");
  assert.equal(normalizeBrowserAddressInput("about:blank"), "about:blank");
  assert.equal(normalizeBrowserAddressInput(""), null);
  assert.equal(normalizeBrowserAddressInput("   "), null);
});

test("address input upgrades host-like text to https", () => {
  assert.equal(normalizeBrowserAddressInput("example.com"), "https://example.com");
  assert.equal(normalizeBrowserAddressInput("example.com/docs?q=1"), "https://example.com/docs?q=1");
  assert.equal(normalizeBrowserAddressInput("localhost:3000"), "https://localhost:3000");
  assert.equal(normalizeBrowserAddressInput("127.0.0.1:8080/app"), "https://127.0.0.1:8080/app");
});

test("address input turns words and unsafe schemes into a search", () => {
  assert.equal(normalizeBrowserAddressInput("hello world"), "https://www.google.com/search?q=hello%20world");
  assert.equal(normalizeBrowserAddressInput("javascript:alert(1)"), "https://www.google.com/search?q=javascript%3Aalert(1)");
  assert.equal(normalizeBrowserAddressInput("file:///etc/passwd"), "https://www.google.com/search?q=file%3A%2F%2F%2Fetc%2Fpasswd");
});

test("blank documents display as an empty address bar", () => {
  assert.equal(browserAddressDisplayValue("about:blank"), "");
  assert.equal(browserAddressDisplayValue("https://example.com"), "https://example.com");
});
