import test from "node:test";
import assert from "node:assert/strict";
import { prBodyMarkdown } from "../src/lib/pr-body.ts";
import { renderMarkdown } from "./markdown-render.ts";

test("GitHub HTML in PR bodies becomes chat Markdown", () => {
  const body = "## Summary\r\n<!-- template hint -->\r\nFixes it.<br>Second line\r\n\r\n<img width=\"600\" alt=\"Screen shot\" src=\"https://github.com/user-attachments/assets/a b\">\r\n<p align=\"center\"><img src='http://insecure/x.png'></p>";
  const markdown = prBodyMarkdown(body);
  assert.ok(!markdown.includes("template hint") && !markdown.includes("<!--"));
  assert.ok(markdown.includes("Fixes it.\nSecond line"));
  assert.ok(markdown.includes("![Screen shot](https://github.com/user-attachments/assets/a%20b)"));
  assert.ok(!markdown.includes("insecure") && !markdown.includes("<p"), "non-https images and layout tags are dropped");
  assert.ok(renderMarkdown(markdown).includes('<img src="https://github.com/user-attachments/assets/a%20b" alt="Screen shot"/>'));
  assert.equal(prBodyMarkdown("<!-- only a template -->\n"), "");
  assert.equal(prBodyMarkdown("<script>x</script>"), "<script>x</script>", "other HTML stays text for React to escape");
});

test("GitHub uploads are recognized by ID only, for the item's own repository", async () => {
  const { githubAttachmentAsset, githubAttachmentAssets } = await import("../src/lib/pr-body.ts");
  const uuid = "e7d69315-2274-4873-a343-7c087c9f8543";
  assert.equal(githubAttachmentAsset(`https://github.com/user-attachments/assets/${uuid.toUpperCase()}`, "acme/app"), uuid);
  assert.equal(githubAttachmentAsset(`https://github.com/Acme/App/assets/123/${uuid}`, "acme/app"), `123/${uuid}`);
  assert.equal(githubAttachmentAsset(`https://github.com/other/repo/assets/123/${uuid}`, "acme/app"), null, "another repository's upload loads like any image");
  for (const url of [`http://github.com/user-attachments/assets/${uuid}`, `https://github.com.evil/user-attachments/assets/${uuid}`, `https://github.com/user-attachments/assets/${uuid}/../x`, `https://github.com/user-attachments/files/1/${uuid}`, "https://example.com/a.png"]) {
    assert.equal(githubAttachmentAsset(url, "acme/app"), null, url);
  }
  const markdown = prBodyMarkdown(`<img src="https://github.com/user-attachments/assets/${uuid}"> and ![x](https://github.com/user-attachments/assets/${uuid}) ![y](https://example.com/y.png)`);
  assert.deepEqual(githubAttachmentAssets(markdown, "acme/app"), [uuid]);
  const many = Array.from({ length: 20 }, (_, index) => `![](https://github.com/user-attachments/assets/${uuid.slice(0, -2)}${String(index).padStart(2, "0")})`).join(" ");
  assert.equal(githubAttachmentAssets(many, "acme/app").length, 12, "bounded per text");
});
