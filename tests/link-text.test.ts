import { test } from "node:test";
import assert from "node:assert/strict";
import { splitLinks } from "../src/lib/link-text.ts";

test("user text links http(s) addresses and leaves sentence punctuation out", () => {
  assert.deepEqual(splitLinks("veja https://yab.one, ok"), [
    { kind: "text", text: "veja " }, { kind: "link", text: "https://yab.one", url: "https://yab.one" }, { kind: "text", text: ", ok" },
  ]);
  assert.deepEqual(splitLinks("(https://example.com/a)").map((segment) => segment.text), ["(", "https://example.com/a", ")"]);
  assert.equal(splitLinks("https://en.wikipedia.org/wiki/Foo_(bar)")[0].text, "https://en.wikipedia.org/wiki/Foo_(bar)");
  assert.deepEqual(splitLinks("sem link"), [{ kind: "text", text: "sem link" }]);
  assert.equal(splitLinks("file:///etc/passwd").some((segment) => segment.kind === "link"), false);
});
