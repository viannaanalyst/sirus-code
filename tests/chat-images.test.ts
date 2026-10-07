import test from "node:test";
import assert from "node:assert/strict";
import { parseChatInline } from "../src/lib/chat-markdown.ts";

test("reply images render for https and data URLs; other paths stay links", () => {
  assert.deepEqual(parseChatInline("veja ![tela](https://x.dev/a.png) ok"), [{ kind: "text", text: "veja " }, { kind: "image", url: "https://x.dev/a.png", alt: "tela" }, { kind: "text", text: " ok" }]);
  assert.equal(parseChatInline("![p](data:image/png;base64,AAAA)")[0].kind, "image");
  assert.deepEqual(parseChatInline("![shot](/tmp/shot.png)"), [{ kind: "link", url: "/tmp/shot.png", children: [{ kind: "text", text: "shot" }] }]);
  assert.equal(parseChatInline("![x](javascript:alert(1))")[0].kind, "link", "never an image from another scheme");
});
