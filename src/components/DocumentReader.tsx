import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { FileText, Minus, Plus } from "@/components/icons/phosphor";
import { client } from "@/client";
import type { DocumentPreview, WordBlock } from "@/client/types";
import type { DockPane } from "@/store/app-store";
import { documentError } from "@/lib/document-reader";
import { useTranslation } from "@/i18n/use-translation";
import { IconButton } from "@/primitives/IconButton";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { SheetReader } from "./SheetReader";

const PdfReader = lazy(async () => ({ default: (await import("./PdfReader")).PdfReader }));

export function ReaderZoom({ zoom, onChange }: { zoom: number; onChange: (zoom: number) => void }) {
  const t = useTranslation();
  return <div className="flex shrink-0 items-center gap-1">
    <IconButton label={t("reader.zoomOut")} disabled={zoom <= 0.5} onClick={() => onChange(Math.max(0.5, zoom - 0.25))} className="size-7 min-h-0 p-0"><Minus size={13} /></IconButton>
    <button type="button" onClick={() => onChange(1)} aria-label={t("reader.fit")} title={t("reader.fit")} className="min-w-10 rounded px-1 py-1 ui-caption text-text-secondary">{Math.round(zoom * 100)}%</button>
    <IconButton label={t("reader.zoomIn")} disabled={zoom >= 2} onClick={() => onChange(Math.min(2, zoom + 0.25))} className="size-7 min-h-0 p-0"><Plus size={13} /></IconButton>
  </div>;
}

export function DocumentReader({ document, active }: { document: NonNullable<DockPane["document"]>; active: boolean }) {
  const t = useTranslation();
  const [result, setResult] = useState<DocumentPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    let cancelled = false;
    client.attachmentPreview(document.owner, document.attachmentId).then((preview) => {
      if (!cancelled) { setResult(preview); setError(null); }
    }).catch((reason: unknown) => { if (!cancelled) setError(documentError(reason)); });
    return () => { cancelled = true; };
  }, [document.owner, document.attachmentId, retry]);
  return <section aria-label={document.name} className="flex h-full min-h-0 flex-col">
    <header className="flex shrink-0 items-center gap-2 border-y border-border-subtle px-3 py-2">
      <FileText size={15} className="shrink-0 text-text-muted" aria-hidden="true" />
      <div className="min-w-0 flex-1"><h2 className="truncate ui-control font-medium" title={document.name}>{document.name}</h2><p className="ui-caption text-text-muted">{t("reader.readOnly")}</p></div>
      {result && result.type !== "pdf" ? <ReaderZoom zoom={zoom} onChange={setZoom} /> : null}
    </header>
    {error ? <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"><p className="text-text-muted">{t(error)}</p><InteractiveButton variant="toolbar" onClick={() => { setError(null); setRetry((value) => value + 1); }}>{t("reader.retry")}</InteractiveButton></div>
      : !result ? <p role="status" className="p-6 text-text-muted">{t("reader.loading")}</p>
      : result.type === "pdf" ? <Suspense fallback={<p role="status" className="p-6 text-text-muted">{t("reader.loading")}</p>}><PdfReader data={result.data} active={active} /></Suspense>
      : result.type === "word" ? <WordReader blocks={result.blocks} zoom={zoom} />
      : <SheetReader sheets={result.sheets} zoom={zoom} />}
  </section>;
}

export function WordReader({ blocks, zoom }: { blocks: WordBlock[]; zoom: number }) {
  const t = useTranslation();
  const area = useRef<HTMLDivElement>(null);
  const headings = blocks.flatMap((block, index) => block.type === "paragraph" && block.heading ? [{ text: block.text, index }] : []);
  return <>
    {headings.length ? <div className="shrink-0 border-b border-border-subtle px-3 py-2"><label className="ui-caption text-text-muted">{t("reader.outline")}<select className="ml-2 max-w-[70%] rounded bg-background-2 p-1 text-text-primary" defaultValue="" onChange={(event) => area.current?.querySelector(`[data-word-block="${Number(event.target.value)}"]`)?.scrollIntoView({ block: "start" })}><option value="" disabled>{t("reader.outline")}</option>{headings.map((heading) => <option key={heading.index} value={heading.index}>{heading.text.slice(0, 200)}</option>)}</select></label></div> : null}
    <div ref={area} className="scroll-thin min-h-0 flex-1 overflow-auto bg-background-2 p-4" tabIndex={0} aria-label={t("reader.title")}>
      <article className="selectable mx-auto min-h-full max-w-[800px] rounded-sm bg-white p-6 text-[#242424] shadow-sm" style={{ fontSize: `${14 * zoom}px`, lineHeight: 1.7 }}>
        {!blocks.length ? <p>{t("reader.empty")}</p> : blocks.map((block, index) => <div key={index} data-word-block={index} className="scroll-mt-4">
          {block.type === "table" ? <div className="my-5 overflow-x-auto"><table className="w-full border-collapse text-left"><tbody>{block.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className="whitespace-pre-wrap border border-[#d4d4d4] px-3 py-2 align-top">{cell}</td>)}</tr>)}</tbody></table></div>
            : block.heading ? <p role="heading" aria-level={block.heading} className="mb-3 mt-5 whitespace-pre-wrap font-semibold" style={{ fontSize: `${Math.max(1.1, 1.8 - block.heading * 0.12)}em` }}>{block.text}</p>
            : <p className="mb-3 whitespace-pre-wrap">{block.list ? "• " : ""}{block.text || "\u00a0"}</p>}
        </div>)}
      </article>
    </div>
    <p className="shrink-0 border-t border-border-subtle px-3 py-2 ui-caption text-text-muted">{t("reader.wordNote")}</p>
  </>;
}
