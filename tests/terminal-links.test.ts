import { test } from "node:test";
import assert from "node:assert/strict";
import { terminalLinkTarget } from "../src/lib/terminal-links.ts";

test("terminal hyperlinks open only absolute http(s) addresses", () => {
  assert.equal(terminalLinkTarget("https://example.com/path?q=1"), "https://example.com/path?q=1");
  assert.equal(terminalLinkTarget("http://localhost:5173/"), "http://localhost:5173/");
  assert.equal(terminalLinkTarget("HTTPS://example.com"), "HTTPS://example.com");
  for (const blocked of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,hi", "mailto:a@b.c", "ftp://example.com", "https://", "example.com", " javascript:https://x", ""]) {
    assert.equal(terminalLinkTarget(blocked), null, blocked);
  }
});
