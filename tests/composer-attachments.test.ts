import { test } from "node:test";
import assert from "node:assert/strict";
import { annotatedImageName, appendAttachments, isAttachmentPaste, pastedFiles, replaceAttachment, attachmentFileLimit } from "../src/lib/composer-attachments.ts";
import { composerPrompt } from "../src/lib/composer-context.ts";

test("paste intercepts screenshot paths with spaces, quoted paths, and file URIs while preserving normal text", () => {
  for (const value of ["/var/folders/T/images/Switchyard 2026-10-01 14.52.29.png", "'/tmp/a b.pdf'", '"/tmp/data.csv"', "file:///tmp/test.docx"]) assert.equal(isAttachmentPaste(value), true);
  for (const value of ["ordinary text", "https://example.com/a.png", "Use /tmp/a.png please", "/tmp/a.png\ntext", "./relative.png"]) assert.equal(isAttachmentPaste(value), false);
});
test("pasted files preserve PNG, PDF, CSV, DOCX and opaque binary bytes without text decoding", async () => {
  for (const name of ["screen.png", "report.pdf", "table.csv", "document.docx", "file.bin"]) {
    const bytes = new Uint8Array([0, 255, 128, 1]);
    const [file] = await pastedFiles([new File([bytes], name)]);
    assert.equal(file.name, name);
    assert.deepEqual(Buffer.from(file.data, "base64"), Buffer.from(bytes));
  }
});
test("paste checks size and count before reading file bodies", async () => {
  const huge = { name: "big.pdf", size: attachmentFileLimit + 1, arrayBuffer() { throw new Error("must not read"); } } as unknown as File;
  await assert.rejects(pastedFiles([huge]), /attachmentFileLimit/);
  await assert.rejects(pastedFiles(Array(9).fill(huge)), /attachmentLimit/);
  assert.throws(() => appendAttachments(Array(8).fill({}), [{}] as never), /attachmentLimit/);
});
test("annotated replacement keeps position, enforces limits and derives safe names", () => {
  const files: { id: string }[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const next = { id: "annotation", name: "shot-annotated.png", kind: "file", content: "", truncated: false, size: 1 } as never;
  assert.deepEqual(replaceAttachment(files as never, "b", next).map((file: { id: string }) => file.id), ["a", "annotation", "c"]);
  assert.deepEqual(replaceAttachment(files as never, "missing", next).map((file: { id: string }) => file.id), ["a", "b", "c", "annotation"]);
  const eight = Array.from({ length: 8 }, (_, index) => ({ id: `x${index}` }));
  assert.equal(replaceAttachment(eight as never, "x3", next).length, 8);
  assert.throws(() => replaceAttachment(eight as never, "missing", next), /attachmentLimit/);
  assert.equal(annotatedImageName("screenshot.png"), "screenshot-annotated.png");
  assert.equal(annotatedImageName("report.final.jpeg"), "report.final-annotated.png");
  assert.equal(annotatedImageName("no-extension"), "no-extension-annotated.png");
  assert.equal(annotatedImageName(".hidden"), "image-annotated.png");
  assert.equal(annotatedImageName("a".repeat(255)).length, 214);
});
test("image-only messages create an explicit request without injecting base64 into transcript text", () => {
  const result = composerPrompt("", { goal: "", planning: false, attachments: [{ id: "native", name: "image.png", kind: "file", content: "", truncated: false, previewUrl: "data:image/png;base64,YWJj" }] });
  assert.ok(result.startsWith("Analyze the attached files."));
  assert.ok(result.includes("image.png"));
  assert.ok(!result.includes("YWJj"));
});
