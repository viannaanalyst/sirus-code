/**
 * Photos and files from a phone (ADR-086). The Mac's file picker is out of reach
 * there, so the browser's own picker (library, camera, Files) supplies the bytes.
 * Large photos are scaled down on the phone first: a 12 MP camera shot becomes a
 * JPEG of at most 2048 px on its longer side, which an agent reads just as well.
 */
export const PHONE_IMAGE_EDGE = 2048;

/** The size an image is scaled to so its longer side fits `edge`; never enlarged. */
export function fittedSize(width: number, height: number, edge = PHONE_IMAGE_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= edge || longest === 0) return { width, height };
  const scale = edge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

async function shrinkImage(file: File): Promise<{ name: string; data: string } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = fittedSize(bitmap.width, bitmap.height);
    if (size.width === bitmap.width && file.size < 2 * 1024 * 1024) { bitmap.close(); return null; }
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return null;
    const name = file.name.replace(/\.[^.]+$/, "") || "photo";
    return { name: `${name}.jpg`, data: base64(await blob.arrayBuffer()) };
  } catch {
    // A format the browser cannot draw is sent as it came.
    return null;
  }
}

/** The chosen files as the Mac's paste command expects them (at most 8). */
export async function readPhoneFiles(files: readonly File[]): Promise<{ name: string; data: string }[]> {
  return Promise.all(files.slice(0, 8).map(async (file) => {
    if (file.type.startsWith("image/") && file.type !== "image/gif") {
      const shrunk = await shrinkImage(file);
      if (shrunk) return shrunk;
    }
    return { name: file.name || "file", data: base64(await file.arrayBuffer()) };
  }));
}
