import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Pencil, Trash2, Undo2, X } from "lucide-react";
import { Dialog, DialogClose, DialogTrigger } from "@/components/arc/dialog/dialog";
import type { PromptAttachment } from "@/client/types";
import { client } from "@/client";
import { annotatedImageName, pastedFiles } from "@/lib/composer-attachments";
import { formatUnknownError } from "@/lib/format-error";
import { useTranslation } from "@/i18n/use-translation";
import { Tooltip } from "@/primitives/Tooltip";

type Point = { x: number; y: number };
const fallbackStroke = "#e5484d";
const strokeWidthFor = (canvas: HTMLCanvasElement) => Math.max(3, Math.round(Math.max(canvas.width, canvas.height) / 300));

function paintStroke(ctx: CanvasRenderingContext2D, points: Point[]) {
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.stroke();
}

/** Fullscreen image viewer that can draw a pointer annotation and replace the original attachment with the result. */
function ComposerImageViewer({ attachment, owner, disabled, open, onReplace, onClose }: {
  attachment: PromptAttachment; owner: string; disabled: boolean; open: boolean; onReplace: (next: PromptAttachment) => void; onClose: () => void;
}) {
  const t = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<HTMLImageElement | null>(null);
  const strokesRef = useRef<Point[][]>([]);
  const drawingRef = useRef<{ pointerId: number; points: Point[] } | null>(null);
  const strokeColor = useRef(fallbackStroke);
  const [ready, setReady] = useState(false);
  const [strokes, setStrokes] = useState(0);
  const [annotating, setAnnotating] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const image = sourceRef.current;
    if (!canvas || !image) return;
    if (canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight) {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    ctx.strokeStyle = strokeColor.current;
    ctx.fillStyle = strokeColor.current;
    ctx.lineWidth = strokeWidthFor(canvas);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokesRef.current) paintStroke(ctx, stroke);
  }, []);

  useEffect(() => {
    if (!open || !attachment.previewUrl) return;
    strokesRef.current = [];
    drawingRef.current = null;
    setStrokes(0);
    setAnnotating(false);
    setError(null);
    setPending(false);
    setReady(false);
    const image = new Image();
    image.onload = () => { sourceRef.current = image; setReady(true); repaint(); };
    image.src = attachment.previewUrl;
    return () => { image.onload = null; };
  }, [open, attachment.previewUrl, repaint]);

  useEffect(() => { repaint(); }, [repaint, strokes]);

  const canvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const canvas = event.currentTarget;
    const box = canvas.getBoundingClientRect();
    return { x: (event.clientX - box.left) * (canvas.width / box.width), y: (event.clientY - box.top) * (canvas.height / box.height) };
  };

  const beginStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!annotating || disabled || pending) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const points = [canvasPoint(event)];
    strokesRef.current = [...strokesRef.current, points];
    drawingRef.current = { pointerId: event.pointerId, points };
    setStrokes(strokesRef.current.length);
  };

  const extendStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drawing = drawingRef.current;
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    const canvas = event.currentTarget;
    const ctx = canvas.getContext("2d");
    const previous = drawing.points[drawing.points.length - 1];
    const next = canvasPoint(event);
    drawing.points.push(next);
    if (!ctx) return;
    ctx.strokeStyle = strokeColor.current;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = strokeWidthFor(canvas);
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
  };

  const endStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (drawingRef.current?.pointerId === event.pointerId) drawingRef.current = null;
  };

  const toggleAnnotation = () => {
    if (disabled || pending) return;
    setError(null);
    setAnnotating((value) => {
      if (!value) strokeColor.current = getComputedStyle(document.documentElement).getPropertyValue("--danger").trim() || fallbackStroke;
      return !value;
    });
  };

  const undoStroke = () => {
    strokesRef.current = strokesRef.current.slice(0, -1);
    setStrokes(strokesRef.current.length);
  };

  const clearStrokes = () => {
    strokesRef.current = [];
    setStrokes(0);
  };

  const replaceOriginal = async () => {
    const canvas = canvasRef.current;
    if (!canvas || disabled || pending || !strokes) return;
    setPending(true);
    setError(null);
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not prepare the annotated image.");
      const [file] = await pastedFiles([new File([blob], annotatedImageName(attachment.name), { type: "image/png" })]);
      const [next] = await client.pastePromptAttachments(owner, [file]);
      if (!next) throw new Error("Could not prepare selected attachments.");
      try {
        onReplace(next);
      } catch (cause) {
        void client.releasePromptAttachments(owner, [next.id]).catch(() => {});
        throw cause;
      }
      onClose();
    } catch (cause) {
      setError(formatUnknownError(cause));
      setPending(false);
    }
  };

  return <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="attachment-viewer-overlay" />
    <DialogPrimitive.Content
      aria-describedby={undefined}
      className="attachment-viewer"
      onClick={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}
      onEscapeKeyDown={(event) => { event.stopPropagation(); if (annotating) { event.preventDefault(); setAnnotating(false); } }}
    >
      <DialogPrimitive.Title className="sr-only">{t("composer.previewAttachment")} · {attachment.name}</DialogPrimitive.Title>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-annotating={annotating}
        className="attachment-viewer-canvas"
        style={{ opacity: ready ? 1 : 0, touchAction: annotating ? "none" : "auto" }}
        onPointerDown={beginStroke}
        onPointerMove={extendStroke}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
      />
      {error
        ? <p role="alert" className="attachment-viewer-status ui-caption text-danger">{t(error)}</p>
        : pending
          ? <p role="status" className="attachment-viewer-status ui-caption">{t("composer.replacingImage")}</p>
          : annotating ? <p className="attachment-viewer-status ui-caption">{t("composer.annotateHint")}</p> : null}
      <div className="attachment-viewer-toolbar">
        <Tooltip label={t("composer.annotateImage")}>
          <button type="button" data-active={annotating} aria-pressed={annotating} aria-label={t("composer.annotateImage")} disabled={disabled || pending || !ready} className="attachment-viewer-tool" onClick={toggleAnnotation}><Pencil size={16} aria-hidden="true" /></button>
        </Tooltip>
        <Tooltip label={t("composer.undoStroke")}>
          <button type="button" aria-label={t("composer.undoStroke")} disabled={disabled || pending || !strokes} className="attachment-viewer-tool" onClick={undoStroke}><Undo2 size={16} aria-hidden="true" /></button>
        </Tooltip>
        <Tooltip label={t("composer.clearStrokes")}>
          <button type="button" aria-label={t("composer.clearStrokes")} disabled={disabled || pending || !strokes} className="attachment-viewer-tool" onClick={clearStrokes}><Trash2 size={16} aria-hidden="true" /></button>
        </Tooltip>
        <button type="button" disabled={disabled || pending || !strokes} className="attachment-viewer-apply ui-control" onClick={() => void replaceOriginal()}><Check size={15} aria-hidden="true" />{t("composer.replaceOriginal")}</button>
      </div>
      <DialogClose asChild>
        <button type="button" className="attachment-viewer-close" aria-label={t("composer.closePreview")}><X size={16} aria-hidden="true" /></button>
      </DialogClose>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>;
}

/** Compact composer thumbnail with a separate remove control and a focus-managed image viewer. */
export function ComposerImageAttachment({ attachment, owner, disabled, onRemove, onReplace }: {
  attachment: PromptAttachment; owner: string; disabled: boolean; onRemove: () => void; onReplace: (next: PromptAttachment) => void;
}) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  return <div className="relative size-9 shrink-0">
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="block size-9 cursor-zoom-in rounded-lg" title={attachment.name} aria-label={`${t("composer.previewAttachment")} · ${attachment.name}`}>
          <img src={attachment.previewUrl!} alt="" draggable={false} className="size-9 rounded-lg object-cover" />
        </button>
      </DialogTrigger>
      <ComposerImageViewer attachment={attachment} owner={owner} disabled={disabled} open={open} onReplace={onReplace} onClose={() => setOpen(false)} />
    </Dialog>
    <button type="button" disabled={disabled} aria-label={`${t("composer.removeAttachment")} · ${attachment.name}`} className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-text-primary/20 text-text-secondary shadow-sm backdrop-blur-sm hover:bg-text-primary/30 hover:text-text-primary disabled:opacity-40" onClick={onRemove}>
      <X size={12} aria-hidden="true" />
    </button>
  </div>;
}
