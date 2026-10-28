import test from "node:test";
import assert from "node:assert/strict";
import { urlTransform } from "../src/lib/markdown-pipeline.ts";

test("reply image targets: https and base64 rasters stay images; other schemes are dropped", () => {
  assert.equal(urlTransform("https://x.dev/a.png", "src"), "https://x.dev/a.png");
  assert.equal(urlTransform("data:image/png;base64,AAAA", "src"), "data:image/png;base64,AAAA");
  assert.equal(urlTransform("data:image/png;base64,AAAA", "href"), "", "data: is an image source only");
  assert.equal(urlTransform("data:image/svg+xml;base64,AAAA", "src"), "");
  assert.equal(urlTransform("/tmp/shot.png", "src"), "/tmp/shot.png", "local paths reach the link or media component");
  assert.equal(urlTransform("javascript:alert(1)", "src"), "");
  assert.equal(urlTransform(" JavaScript:alert(1)", "href"), "");
  assert.equal(urlTransform("vbscript:x", "href"), "");
});

test("links to image files on the Mac open in the gallery; web and other links do not", async () => {
  const { isLocalImageLink } = await import("../src/lib/chat-markdown.ts");
  for (const yes of ["/tmp/previews/a.png", "~/Desktop/b.JPG", "shots/c.webp", "file:///tmp/d.gif", "/tmp/e.jpeg?v=2"]) assert.equal(isLocalImageLink(yes), true, yes);
  for (const no of ["https://x.dev/a.png", "javascript:alert(1).png", "data:image/png;base64,AA", "/tmp/notes.md", "/tmp/a.svg", "mailto:a.png"]) assert.equal(isLocalImageLink(no), false, no);
});

test("local images and videos are shown inline; web links and other files are not (ADR-119)", async () => {
  const { localMediaKind, localMediaPath, isLocalVideoLink } = await import("../src/lib/chat-markdown.ts");
  for (const image of ["/tmp/shot.png", "shots/a.JPG", "~/Desktop/b.webp", "file:///tmp/c.gif"]) assert.equal(localMediaKind(image), "image", image);
  for (const video of ["/tmp/demo.mp4", "recordings/run.MOV", "./clip.webm", "~/Movies/x.m4v", "file:///tmp/y.mp4", "/tmp/z.mp4?t=3"]) assert.equal(localMediaKind(video), "video", video);
  for (const other of ["https://x.dev/a.mp4", "http://x.dev/a.png", "javascript:a.mp4", "data:video/mp4;base64,AA", "/tmp/a.mkv", "/tmp/notes.md", "/tmp/archive", "mailto:a.mov"]) assert.equal(localMediaKind(other), null, other);
  assert.equal(isLocalVideoLink("/tmp/a.png"), false);
  assert.equal(localMediaPath(" /tmp/z.mp4?t=3 "), "/tmp/z.mp4");
  assert.equal(localMediaPath("shots/a.png#frag"), "shots/a.png");
});
