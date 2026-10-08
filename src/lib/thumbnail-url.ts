import { client } from "@/client";
import type { MessageAttachment } from "@/client/types";

/**
 * The image a sent message shows for an attachment, or `undefined` for files and
 * folders. Thumbnails are files on the Mac loaded by id (the `sirus-thumb` scheme on
 * the desktop, an authenticated route for a paired device); older messages and
 * failed writes still embed a data URL.
 */
export function thumbnailUrl(
  attachment: MessageAttachment,
  resolve: (id: string) => string | undefined = (id) => client.thumbnailUrl(id),
): string | undefined {
  if (attachment.thumbnail) return attachment.thumbnail;
  return attachment.hasThumbnail && attachment.id ? resolve(attachment.id) : undefined;
}

/** The small copy a message bubble shows (about 192 px); the viewer keeps `thumbnailUrl`. */
export function smallThumbnailUrl(
  attachment: MessageAttachment,
  resolve: (id: string) => string | undefined = (id) => client.thumbnailUrl(id),
): string | undefined {
  const url = thumbnailUrl(attachment, resolve);
  if (!url || url.startsWith("data:")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}size=small`;
}
