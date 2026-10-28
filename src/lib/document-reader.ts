import type { PromptAttachment } from "../client/types";

/** The largest file the reader opens; matches the native snapshot bound (`attachments::MAX_FILE_BYTES`). */
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
/** The Office files drawn by the lazily loaded engines (ADR-184); the legacy binary formats are not supported. */
export type OfficeKind = "docx" | "xlsx" | "pptx";
const OFFICE_MIME: Record<string, OfficeKind> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};
export function officeKind(name: string, mimeType?: string): OfficeKind | null {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (extension === "docx" || extension === "xlsx" || extension === "pptx") return extension;
  return OFFICE_MIME[mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? ""] ?? null;
}
/** What the file pane opens in the document reader instead of the text editor. */
export function isWorkspaceDocument(path: string): boolean {
  return /\.(pdf|docx|xlsx|pptx)$/i.test(path);
}
export function canReadDocument(file: PromptAttachment): boolean {
  return file.kind === "file" && (file.mimeType === "application/pdf" || officeKind(file.name, file.mimeType) !== null || /\.(pdf|docx|xlsx|pptx|csv|doc|xls|ppt)$/i.test(file.name));
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
/** The decoded size of a base64 payload, without decoding it. */
export function base64Size(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(data.length * 3 / 4) - padding);
}
/** The bytes of a native document payload, refusing anything past the reader's bound. */
export function documentBytes(data: string): ArrayBuffer {
  if (base64Size(data) > DOCUMENT_MAX_BYTES) throw new Error("limit");
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}
/** Which message a failed Office render shows: the engines throw `limit` for page, slide and sheet bounds. */
export function officeFailure(reason: unknown): "reader.officeLimit" | "reader.officeError" {
  return reason instanceof Error && reason.message === "limit" ? "reader.officeLimit" : "reader.officeError";
}
