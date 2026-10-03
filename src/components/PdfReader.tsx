import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { useTranslation } from "@/i18n/use-translation";
import { IconButton } from "@/primitives/IconButton";
import { ReaderZoom } from "./DocumentReader";

GlobalWorkerOptions.workerSrc = workerUrl;

export function PdfReader({ data, active }: { data: string; active: boolean }) {
  const t = useTranslation();
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [showText, setShowText] = useState(false);
  const [loading, setLoading] = useState(true);
  const [width, setWidth] = useState(400);
  const [attempt, setAttempt] = useState(0);
  const area = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let disposed = false;
    const binary = atob(data);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const root = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href).href;
    const task = getDocument({ data: bytes, cMapUrl: `${root}cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}standard_fonts/`, disableFontFace: true, useSystemFonts: false, useWasm: false, useWorkerFetch: true, maxImageSize: 12_000_000, canvasMaxAreaInBytes: 48_000_000, stopAtErrors: true });
    const timer = setTimeout(() => { if (!disposed) { setError("reader.pdfError"); void task.destroy(); } }, 30_000);
    task.onPassword = () => { if (!disposed) setError("reader.pdfError"); void task.destroy(); };
    task.promise.then((document) => {
      clearTimeout(timer);
      if (disposed) return;
      if (document.numPages > 1000) { setError("reader.pdfLimit"); void task.destroy(); return; }
      setPdf(document);
    }).catch(() => { if (!disposed) setError("reader.pdfError"); clearTimeout(timer); });
    return () => { disposed = true; clearTimeout(timer); void task.destroy(); };
  }, [data, attempt]);
  useEffect(() => {
    if (!area.current) return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured > 0) setWidth(Math.max(160, measured - 32));
    });
    observer.observe(area.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf || !canvas.current || !active) return;
    let cancelled = false;
    let render: RenderTask | undefined;
    const timer = setTimeout(() => {
      if (!cancelled) { cancelled = true; render?.cancel(); setError("reader.pdfLimit"); setLoading(false); void pdf.loadingTask.destroy(); }
    }, 30_000);
    const target = canvas.current;
    pdf.getPage(page).then(async (documentPage) => {
      if (cancelled) return;
      setLoading(true);
      const original = documentPage.getViewport({ scale: 1 });
      const viewport = documentPage.getViewport({ scale: Math.min(width / original.width, 2) * zoom });
      if (!Number.isFinite(viewport.width + viewport.height) || viewport.width <= 0 || viewport.height <= 0 || viewport.width > 8192 || viewport.height > 8192) throw new Error("limit");
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(12_000_000 / (viewport.width * viewport.height)));
      target.width = Math.ceil(viewport.width * ratio); target.height = Math.ceil(viewport.height * ratio);
      target.style.width = `${viewport.width}px`; target.style.height = `${viewport.height}px`;
      const context = target.getContext("2d", { alpha: false });
      if (!context) throw new Error("canvas");
      render = documentPage.render({ canvas: target, canvasContext: context, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await render.promise;
      if (cancelled) return;
      const content = await documentPage.getTextContent();
      let words = "";
      for (const item of content.items) {
        if ("str" in item) words += item.str + (item.hasEOL ? "\n" : " ");
        if (words.length > 1_000_000) throw new Error("limit");
      }
      if (!cancelled) { setText(words); setLoading(false); setError(null); documentPage.cleanup(); }
    }).catch((reason: unknown) => {
      if (!cancelled) { setError(reason instanceof Error && reason.message === "limit" ? "reader.pdfLimit" : "reader.pdfError"); setLoading(false); }
    }).finally(() => clearTimeout(timer));
    return () => { cancelled = true; clearTimeout(timer); render?.cancel(); };
  }, [pdf, page, zoom, width, active]);
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3 py-1.5">
      <div className="flex items-center gap-1">
        <IconButton label={t("reader.previous")} disabled={!pdf || page <= 1} onClick={() => setPage((value) => value - 1)} className="size-7 min-h-0 p-0"><ChevronLeft size={14} /></IconButton>
        <input aria-label={t("reader.pageNumber")} type="number" min={1} max={pdf?.numPages ?? 1} value={page} disabled={!pdf} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= (pdf?.numPages ?? 1)) setPage(value); }} className="w-12 rounded bg-background-2 px-1 py-1 text-center ui-caption" />
        <span className="ui-caption text-text-muted">/ {pdf?.numPages ?? "…"}</span>
        <IconButton label={t("reader.next")} disabled={!pdf || page >= pdf.numPages} onClick={() => setPage((value) => value + 1)} className="size-7 min-h-0 p-0"><ChevronRight size={14} /></IconButton>
      </div>
      <ReaderZoom zoom={zoom} onChange={setZoom} />
    </div>
    <div ref={area} className="scroll-thin min-h-0 flex-1 overflow-auto bg-background-2 p-4" tabIndex={0} aria-label={t("reader.page", { page, total: pdf?.numPages ?? "…" })} aria-busy={loading && !error}>
      {error ? <div role="alert" className="p-4 text-text-muted"><p>{t(error)}</p><button type="button" className="mt-3 rounded bg-background-3 px-3 py-2" onClick={() => { setError(null); setPdf(null); setLoading(true); setPage(1); setAttempt((value) => value + 1); }}>{t("reader.retry")}</button></div> : <>
        {loading ? <p role="status" className="pb-3 text-text-muted">{t("reader.loading")}</p> : null}
        {showText ? <pre className="selectable mt-4 whitespace-pre-wrap rounded bg-background-1 p-4 text-text-primary">{text || t("reader.empty")}</pre> : null}
      </>}
      <canvas ref={canvas} role="img" aria-label={t("reader.page", { page, total: pdf?.numPages ?? "…" })} className={error ? "hidden" : "mx-auto bg-white shadow-sm"} />
    </div>
    <div className="shrink-0 border-t border-border-subtle px-3 py-2"><button type="button" aria-pressed={showText} onClick={() => setShowText((value) => !value)} className="rounded px-2 py-1 ui-caption text-text-secondary hover:bg-background-3">{t("reader.pageText")}</button></div>
  </div>;
}
