import assert from "node:assert/strict";
import { test } from "node:test";
import { Buffer } from "node:buffer";
import { base64Size, canReadDocument, columnName, DOCUMENT_MAX_BYTES, documentBytes, documentError, isWorkspaceDocument, officeFailure, officeKind } from "../src/lib/document-reader.ts";

test("only file attachments offer document reading, with uppercase and native PDF MIME support", () => {
  const file = { id: "id", kind: "file" as const, name: "Report.DOCX", content: "", truncated: false };
  for (const name of ["Report.DOCX", "data.xlsx", "data.csv", "old.xls", "old.doc", "file.PDF"]) assert.equal(canReadDocument({ ...file, name }), true);
  assert.equal(canReadDocument({ ...file, name: "scan.bin", mimeType: "application/pdf" }), true);
  assert.equal(canReadDocument({ ...file, name: "source.ts" }), false);
  assert.equal(canReadDocument({ ...file, kind: "folder" }), false);
});
test("spreadsheet headers use actual Excel coordinates", () => {
  assert.deepEqual([0,25,26,51,52,127].map(columnName), ["A","Z","AA","AZ","BA","DX"]);
});
test("Office files are detected by extension or by their OOXML MIME type, never from legacy formats", () => {
  assert.equal(officeKind("Deck.PPTX"), "pptx");
  assert.equal(officeKind("sheet.xlsx", "application/octet-stream"), "xlsx");
  assert.equal(officeKind("noext", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "docx");
  assert.equal(officeKind("noext", "application/vnd.openxmlformats-officedocument.presentationml.presentation; charset=binary"), "pptx");
  for (const name of ["old.doc", "old.xls", "old.ppt", "data.csv", "archive.docx.zip", "docx"]) assert.equal(officeKind(name), null, name);
});
test("the reader offers PDF and Office files in the workspace, and PowerPoint attachments", () => {
  for (const path of ["a/report.pdf", "Deck.PPTX", "dir/x.docx", "y.xlsx"]) assert.equal(isWorkspaceDocument(path), true, path);
  for (const path of ["notes.md", "data.csv", "old.ppt", "pptx", "image.png"]) assert.equal(isWorkspaceDocument(path), false, path);
  const file = { id: "id", kind: "file" as const, name: "Deck.pptx", content: "", truncated: false };
  assert.equal(canReadDocument(file), true);
  assert.equal(canReadDocument({ ...file, name: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }), true);
  assert.equal(canReadDocument({ ...file, name: "old.ppt" }), true, "legacy files open to show the conversion notice");
});
test("Office payloads are bounded before they are decoded", () => {
  const encode = (size: number) => Buffer.alloc(size, 1).toString("base64");
  for (const size of [0, 1, 2, 3, 1000]) assert.equal(base64Size(encode(size)), size);
  assert.equal(documentBytes(encode(1000)).byteLength, 1000);
  assert.equal(documentBytes(encode(DOCUMENT_MAX_BYTES)).byteLength, DOCUMENT_MAX_BYTES);
  assert.throws(() => documentBytes(encode(DOCUMENT_MAX_BYTES + 1)), /limit/);
});
test("a failed Office render reports limits apart from other failures", () => {
  assert.equal(officeFailure(new Error("limit")), "reader.officeLimit");
  assert.equal(officeFailure(new Error("The worker holds no document")), "reader.officeError");
  assert.equal(officeFailure("limit"), "reader.officeError");
});
test("reader errors retain the native category through LocalTransport wrapping", () => {
  assert.equal(documentError({ code: "document_limit", message: "private" }), "reader.document_limit");
  assert.equal(documentError(new Error("wrapped", { cause: { code: "document_unavailable" } })), "reader.document_unavailable");
  assert.equal(documentError(new Error("unknown")), "reader.failed");
});
