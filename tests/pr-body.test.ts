import test from "node:test";
import assert from "node:assert/strict";
import { prBodyMarkdown } from "../src/lib/pr-body.ts";
import { parseChatInline, parseChatMarkdown } from "../src/lib/chat-markdown.ts";

test("GitHub HTML in PR bodies becomes chat Markdown", () => {
  const body = "## Summary\r\n<!-- template hint -->\r\nFixes it.<br>Second line\r\n\r\n<img width=\"600\" alt=\"Screen shot\" src=\"https://github.com/user-attachments/assets/a b\">\r\n<p align=\"center\"><img src='http://insecure/x.png'></p>";
  const markdown = prBodyMarkdown(body);
  assert.ok(!markdown.includes("template hint") && !markdown.includes("<!--"));
  assert.ok(markdown.includes("Fixes it.\nSecond line"));
  assert.ok(markdown.includes("![Screen shot](https://github.com/user-attachments/assets/a%20b)"));
  assert.ok(!markdown.includes("insecure") && !markdown.includes("<p"), "non-https images and layout tags are dropped");
  const image = parseChatMarkdown(markdown).flatMap((block) => block.kind === "paragraph" ? parseChatInline(block.text) : []).find((node) => node.kind === "image");
  assert.deepEqual(image, { kind: "image", url: "https://github.com/user-attachments/assets/a%20b", alt: "Screen shot" });
  assert.equal(prBodyMarkdown("<!-- only a template -->\n"), "");
  assert.equal(prBodyMarkdown("<script>x</script>"), "<script>x</script>", "other HTML stays text for React to escape");
});
