import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "@/components/icons/phosphor";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { useTranslation } from "@/i18n/use-translation";
import { IconButton } from "@/primitives/IconButton";
import { ReaderZoom } from "./DocumentReader";

GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * A PDF as one continuous scroll (after T3 Code): every page is laid out at its size and drawn
 * only near the viewport. The page counter follows the scroll; arrows and the number jump.
 */
export function PdfReader({ data, active }: { data: string; active: boolean }) {
  const t = useTranslation();
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<{ width: number; height: number }[]>([]);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(400);
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    const binary = atob(data);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const root = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href).href;
    const task = getDocument({ data: bytes, cMapUrl: `${root}cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}standard_fonts/`, disableFontFace: true, useSystemFonts: false, useWasm: false, useWorkerFetch: true, maxImageSize: 12_000_000, canvasMaxAreaInBytes: 48_000_000, stopAtErrors: true });
    const timer = setTimeout(() => { if (!disposed) { setError("reader.pdfError"); void task.destroy(); } }, 30_000);
    task.onPassword = () => { if (!disposed) setError("reader.pdfError"); void task.destroy(); };
    task.promise.then(async (document) => {
      clearTimeout(timer);
      if (disposed) return;
      if (document.numPages > 1000) { setError("reader.pdfLimit"); void task.destroy(); return; }
      // Page sizes first, so the whole document has its height before anything is drawn.
      const measured: { width: number; height: number }[] = [];
      for (let index = 1; index <= document.numPages; index += 1) {
        const viewport = (await document.getPage(index)).getViewport({ scale: 1 });
        measured.push({ width: viewport.width, height: viewport.height });
        if (disposed) return;
      }
      setSizes(measured);
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
  const scaleFor = (size: { width: number }) => Math.min(width / size.width, 2) * zoom;
  // The page counter follows whichever page fills the middle of the viewport.
  useEffect(() => {
    const node = area.current;
    if (!node || !pdf) return;
    const onScroll = () => {
      const middle = node.scrollTop + node.clientHeight / 2;
      const pages = node.querySelectorAll<HTMLElement>("[data-pdf-page]");
      for (const element of pages) {
        if (element.offsetTop + element.offsetHeight >= middle) { setPage(Number(element.dataset.pdfPage)); break; }
      }
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, [pdf]);
  const goTo = (target: number) => {
    const node = area.current?.querySelector<HTMLElement>(`[data-pdf-page="${target}"]`);
    if (node && area.current) area.current.scrollTop = node.offsetTop - 16;
    setPage(target);
  };
  useEffect(() => {
    if (!showText || !pdf || text !== null) return;
    let cancelled = false;
    void (async () => {
      let words = "";
      for (let index = 1; index <= pdf.numPages && words.length < 1_000_000; index += 1) {
        const content = await (await pdf.getPage(index)).getTextContent();
        for (const item of content.items) if ("str" in item) words += item.str + (item.hasEOL ? "\n" : " ");
        words += "\n\n";
      }
      if (!cancelled) setText(words.trim());
    })().catch(() => { if (!cancelled) setText(""); });
    return () => { cancelled = true; };
  }, [showText, pdf, text]);
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3 py-1.5">
      <div className="flex items-center gap-1">
        <IconButton label={t("reader.previous")} disabled={!pdf || page <= 1} onClick={() => goTo(page - 1)} className="size-7 min-h-0 p-0"><ChevronLeft size={14} /></IconButton>
        <input aria-label={t("reader.pageNumber")} type="number" min={1} max={pdf?.numPages ?? 1} value={page} disabled={!pdf} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && pdf && value >= 1 && value <= pdf.numPages) goTo(value); }} className="w-12 rounded border border-border-subtle bg-background-1 px-1 py-0.5 text-center ui-caption" />
        <span className="ui-caption text-text-muted">/ {pdf?.numPages ?? "…"}</span>
        <IconButton label={t("reader.next")} disabled={!pdf || page >= pdf.numPages} onClick={() => goTo(page + 1)} className="size-7 min-h-0 p-0"><ChevronRight size={14} /></IconButton>
      </div>
      <ReaderZoom zoom={zoom} onChange={setZoom} />
    </div>
    <div ref={area} className="scroll-thin relative min-h-0 flex-1 overflow-auto bg-background-2 p-4" tabIndex={0} aria-label={t("reader.page", { page, total: pdf?.numPages ?? "…" })} aria-busy={!pdf && !error}>
      {error ? <div role="alert" className="p-4 text-text-muted"><p>{t(error)}</p><button type="button" className="mt-3 rounded bg-background-3 px-3 py-2" onClick={() => { setError(null); setPdf(null); setSizes([]); setAttempt((value) => value + 1); }}>{t("reader.retry")}</button></div>
        : !pdf ? <p role="status" className="pb-3 text-text-muted">{t("reader.loading")}</p>
        : showText ? <pre className="selectable whitespace-pre-wrap rounded bg-background-1 p-4 text-text-primary">{text === null ? t("reader.loading") : text || t("reader.empty")}</pre>
        : <div className="flex flex-col items-center gap-4">
          {sizes.map((size, index) => <PdfPage key={index} pdf={pdf} number={index + 1} width={size.width * scaleFor(size)} height={size.height * scaleFor(size)} scale={scaleFor(size)} root={area} active={active} label={t("reader.page", { page: index + 1, total: pdf.numPages })} />)}
        </div>}
    </div>
    <div className="shrink-0 border-t border-border-subtle px-3 py-2"><button type="button" aria-pressed={showText} onClick={() => setShowText((value) => !value)} className="rounded px-2 py-1 ui-caption text-text-secondary hover:bg-background-3">{t("reader.pageText")}</button></div>
  </div>;
}

/** One page: its full size reserved, drawn once it comes near the viewport and released when far away. */
function PdfPage({ pdf, number, width, height, scale, root, active, label }: { pdf: PDFDocumentProxy; number: number; width: number; height: number; scale: number; root: React.RefObject<HTMLDivElement | null>; active: boolean; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!box.current) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root: root.current, rootMargin: "800px 0px" });
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [root]);
  useEffect(() => {
    const target = canvas.current;
    if (!near || !active || !target) return;
    let cancelled = false;
    let render: RenderTask | undefined;
    void pdf.getPage(number).then(async (documentPage) => {
      if (cancelled) return;
      const viewport = documentPage.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(12_000_000 / (viewport.width * viewport.height)));
      target.width = Math.ceil(viewport.width * ratio); target.height = Math.ceil(viewport.height * ratio);
      const context = target.getContext("2d", { alpha: false });
      if (!context) return;
      render = documentPage.render({ canvas: target, canvasContext: context, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await render.promise;
      documentPage.cleanup();
    }).catch(() => undefined);
    return () => { cancelled = true; render?.cancel(); };
  }, [near, active, pdf, number, scale]);
  return <div ref={box} data-pdf-page={number} className="shrink-0 bg-white shadow-sm" style={{ width, height }}>
    {near ? <canvas ref={canvas} role="img" aria-label={label} style={{ width, height, display: "block" }} /> : null}
  </div>;
}
