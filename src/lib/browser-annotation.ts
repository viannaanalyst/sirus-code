// Annotations with a screenshot (ADR-151): the text the agent reads, and the cropped picture of the
// marked elements that goes with it as composer attachments.

/** An annotated element as the native side measured it (CSS px in the viewport). */
export interface AnnotatedElementInput { selector: string; label: string; x: number; y: number; width: number; height: number }
/** What `browser_annotate_capture` returns. */
export interface BrowserAnnotationCaptureInput {
  url: string;
  viewportWidth: number;
  viewportHeight: number;
  elements: AnnotatedElementInput[];
  png?: string | null;
}

export interface CropRect { x: number; y: number; width: number; height: number }

/** The text attachment: page, viewport and one numbered line per element with its selector. */
export function annotationText(capture: BrowserAnnotationCaptureInput): string {
  const header = [
    capture.url ? `Page: ${capture.url}` : "Page: (unknown)",
    `Viewport: ${Math.round(capture.viewportWidth)}×${Math.round(capture.viewportHeight)}`,
  ];
  const items = capture.elements.map((element, index) => `${index + 1}. ${element.label} — ${element.selector}`);
  return [...header, "", "Annotated elements:", ...items].join("\n");
}

/**
 * The part of the screenshot that holds every marked element, padded and mapped from viewport
 * CSS px to the image's pixels. Null when nothing is marked or the sizes are unusable.
 */
export function annotationCropRect(
  elements: AnnotatedElementInput[],
  viewport: { width: number; height: number },
  image: { width: number; height: number },
  padding = 16,
): CropRect | null {
  if (!elements.length || viewport.width <= 0 || viewport.height <= 0 || image.width <= 0 || image.height <= 0) return null;
  const left = Math.min(...elements.map((element) => element.x)) - padding;
  const top = Math.min(...elements.map((element) => element.y)) - padding;
  const right = Math.max(...elements.map((element) => element.x + element.width)) + padding;
  const bottom = Math.max(...elements.map((element) => element.y + element.height)) + padding;
  const scaleX = image.width / viewport.width;
  const scaleY = image.height / viewport.height;
  const x = Math.max(0, Math.floor(left * scaleX));
  const y = Math.max(0, Math.floor(top * scaleY));
  const width = Math.min(image.width, Math.ceil(right * scaleX)) - x;
  const height = Math.min(image.height, Math.ceil(bottom * scaleY)) - y;
  if (width < 1 || height < 1) return null;
  return { x, y, width, height };
}

/**
 * The screenshot cropped to the marked elements, as base64 PNG; null when there is nothing to crop.
 * Runs in the window (canvas): the image's own pixel size maps the viewport's CSS px onto it.
 */
export async function cropAnnotationPng(png: string, capture: BrowserAnnotationCaptureInput): Promise<string | null> {
  const image = new Image();
  image.src = `data:image/png;base64,${png}`;
  await image.decode();
  const rect = annotationCropRect(capture.elements, { width: capture.viewportWidth, height: capture.viewportHeight }, { width: image.naturalWidth, height: image.naturalHeight });
  if (!rect) return null;
  const canvas = document.createElement("canvas");
  canvas.width = rect.width;
  canvas.height = rect.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
}

/** Base64 of UTF-8 text, the form the attachment paste takes. */
export function base64Text(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
