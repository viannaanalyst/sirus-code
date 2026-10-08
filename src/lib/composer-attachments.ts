import type { PromptAttachment } from "@/client/types";

export const attachmentFileLimit = 10 * 1024 * 1024;
export const attachmentBatchLimit = 40 * 1024 * 1024;
/** Only intercept single local paths. Ordinary prose and remote links paste normally. */
export function isAttachmentPaste(text: string): boolean {
  if (text.length > 8192 || /[\r\n\0]/.test(text)) return false;
  const value = text.trim().replace(/^(["'])(.*)\1$/, "$2");
  return value.startsWith("file:///") || /^\/[^\r\n]+\.[\p{L}\p{N}]{1,12}$/u.test(value);
}
export function appendAttachments(current: PromptAttachment[], added: PromptAttachment[]): PromptAttachment[] {
  if (current.length + added.length > 8) throw new Error("composer.attachmentLimit");
  if ([...current, ...added].reduce((total, file) => total + (file.size ?? 0), 0) > attachmentBatchLimit) throw new Error("composer.attachmentBatchLimit");
  return [...current, ...added];
}
export function replaceAttachment(current: PromptAttachment[], id: string, next: PromptAttachment): PromptAttachment[] {
  const index = current.findIndex((file) => file.id === id);
  if (index < 0) return appendAttachments(current, [next]);
  const remaining = current.filter((file) => file.id !== id);
  const updated = appendAttachments(remaining, [next]).slice(0, -1);
  updated.splice(index, 0, next);
  return updated;
}
export function annotatedImageName(name: string): string {
  const base = name.replace(/\.[^./\\]{1,12}$/u, "").trim() || "image";
  return `${base.slice(0, 200)}-annotated.png`;
}
export async function pastedFiles(files: File[]): Promise<{ name: string; data: string }[]> {
  if (files.length > 8) throw new Error("composer.attachmentLimit");
  if (files.some((file) => file.size > attachmentFileLimit)) throw new Error("composer.attachmentFileLimit");
  if (files.reduce((total, file) => total + file.size, 0) > attachmentBatchLimit) throw new Error("composer.attachmentBatchLimit");
  return Promise.all(files.map(async (file) => ({ name: file.name, data: await fileBase64(file) })));
}
/**
 * Base64 of a file body. The webview's FileReader encodes natively, off the JS heap;
 * a byte loop with `btoa` is only the fallback (Node tests, older engines).
 */
export async function fileBase64(file: Blob): Promise<string> {
  if (typeof FileReader === "function") {
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("composer.attachmentRead"));
      reader.readAsDataURL(file);
    });
    return url.slice(url.indexOf(",") + 1);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (typeof native === "function") return native.call(bytes);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
