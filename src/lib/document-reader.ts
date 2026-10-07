import type { PromptAttachment } from "../client/types";

export function canReadDocument(file: PromptAttachment): boolean {
  return file.kind === "file" && (file.mimeType === "application/pdf" || /\.(pdf|docx|xlsx|csv|doc|xls)$/i.test(file.name));
}
/** What the attachment modal can show: readable documents, HTML pages and text sources. */
export function canPreviewAttachment(file: PromptAttachment): boolean {
  return file.kind === "file" && (canReadDocument(file) || /\.html?$/i.test(file.name) || file.mimeType === "text/html" || Boolean(file.content));
}
export function columnName(column: number): string {
  let value = column + 1;
  let result = "";
  while (value > 0) { value--; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
}
export function documentError(error: unknown): string {
  const native = error instanceof Error && error.cause ? error.cause : error;
  const code = native && typeof native === "object" && "code" in native ? String(native.code) : "";
  return ["document_limit", "document_invalid", "document_unsupported", "document_busy", "document_unavailable"].includes(code) ? `reader.${code}` : "reader.failed";
}
