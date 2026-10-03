import assert from "node:assert/strict";
import { test } from "node:test";
import { canReadDocument, columnName, documentError } from "../src/lib/document-reader.ts";

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
test("reader errors retain the native category through LocalTransport wrapping", () => {
  assert.equal(documentError({ code: "document_limit", message: "private" }), "reader.document_limit");
  assert.equal(documentError(new Error("wrapped", { cause: { code: "document_unavailable" } })), "reader.document_unavailable");
  assert.equal(documentError(new Error("unknown")), "reader.failed");
});
