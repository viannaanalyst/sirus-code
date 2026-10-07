import test from "node:test";
import assert from "node:assert/strict";
import { parseChatInline } from "../src/lib/chat-markdown.ts";

test("reply images render for https and data URLs; other paths stay links", () => {
  assert.deepEqual(parseChatInline("veja ![tela](https://x.dev/a.png) ok"), [{ kind: "text", text: "veja " }, { kind: "image", url: "https://x.dev/a.png", alt: "tela" }, { kind: "text", text: " ok" }]);
  assert.equal(parseChatInline("![p](data:image/png;base64,AAAA)")[0].kind, "image");
  assert.deepEqual(parseChatInline("![shot](/tmp/shot.png)"), [{ kind: "link", url: "/tmp/shot.png", children: [{ kind: "text", text: "shot" }] }]);
  assert.equal(parseChatInline("![x](javascript:alert(1))")[0].kind, "link", "never an image from another scheme");
});

test("links to image files on the Mac open in the gallery; web and other links do not", async () => {
  const { isLocalImageLink } = await import("../src/lib/chat-markdown.ts");
  for (const yes of ["/tmp/previews/a.png", "~/Desktop/b.JPG", "shots/c.webp", "file:///tmp/d.gif", "/tmp/e.jpeg?v=2"]) assert.equal(isLocalImageLink(yes), true, yes);
  for (const no of ["https://x.dev/a.png", "javascript:alert(1).png", "data:image/png;base64,AA", "/tmp/notes.md", "/tmp/a.svg", "mailto:a.png"]) assert.equal(isLocalImageLink(no), false, no);
});
