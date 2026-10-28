import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { OfficeFormat } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { documentBytes, officeFailure } from "@/lib/document-reader";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { OfficeLoading, OFFICE_SUBHEADER_CLASS } from "./chrome";

// The engines and their WebAssembly load only when an Office file is opened (ADR-184).
const WordDocument = lazy(() => import("./WordDocument"));
const Spreadsheet = lazy(() => import("./Spreadsheet"));
const Presentation = lazy(() => import("./Presentation"));

const OPEN_TIMEOUT = 30_000;

/**
 * A Word, Excel or PowerPoint file drawn read-only by the Better Office engines in a worker.
 * `data` is the bounded base64 payload the native side already checked. Word and Excel offer the
 * typed text view when the engine cannot draw a file.
 */
export function OfficeReader({ format, data, onPlain }: { format: OfficeFormat; data: string; onPlain?: () => void }) {
  const t = useTranslation();
  const [details, setDetails] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const decoded = useMemo(() => {
    try { return { bytes: documentBytes(data) }; } catch (reason) { return { error: officeFailure(reason) }; }
  }, [data]);
  const error = failure ?? decoded.error ?? null;
  const fail = useCallback((reason: unknown) => setFailure(officeFailure(reason)), []);
  // A document that never reports its first page, slide or sheet is given up on, as the PDF reader does.
  useEffect(() => {
    if (details || error) return;
    const timer = setTimeout(() => setFailure("reader.officeTimeout"), OPEN_TIMEOUT);
    return () => clearTimeout(timer);
  }, [details, error, attempt]);
  if (error || !decoded.bytes) {
    return <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-text-muted">{t(error ?? "reader.officeError")}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <InteractiveButton variant="toolbar" onClick={() => { setFailure(null); setDetails(""); setAttempt((value) => value + 1); }}>{t("reader.retry")}</InteractiveButton>
        {onPlain && format !== "pptx" ? <InteractiveButton variant="toolbar" onClick={onPlain}>{t("reader.textView")}</InteractiveButton> : null}
      </div>
    </div>;
  }
  const Viewer = format === "docx" ? WordDocument : format === "xlsx" ? Spreadsheet : Presentation;
  const summary = !details ? "" : t(format === "docx" ? "reader.pagesCount" : format === "pptx" ? "reader.slidesCount" : "reader.sheetsCount", { count: details });
  return <div className="flex min-h-0 flex-1 flex-col" data-office-reader={format}>
    {summary ? <div className={OFFICE_SUBHEADER_CLASS}><span className="ui-caption text-text-muted" aria-live="polite">{summary}</span></div> : null}
    <Suspense fallback={<OfficeLoading />}>
      <Viewer key={attempt} bytes={decoded.bytes} onDetails={setDetails} onError={fail} />
    </Suspense>
  </div>;
}
