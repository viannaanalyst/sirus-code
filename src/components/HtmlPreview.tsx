import { useEffect, useRef, useState } from "react";
import { client } from "@/client";
import { Code, Eye } from "@/components/icons/phosphor";
import { CodeBlock } from "@/components/arc/code-block/code-block";
import { useTranslation } from "@/i18n/use-translation";

/**
 * HTML running on its own isolated origin (ADR-072) in a sandboxed frame. With `fit`, the frame
 * follows the page height (80–720 px); otherwise it fills its container.
 */
export function HtmlPage({ source, fit = false, className }: { source: string; fit?: boolean; className?: string }) {
  const t = useTranslation();
  const frame = useRef<HTMLIFrameElement>(null);
  const [id, setId] = useState<string | null>(null);
  const [height, setHeight] = useState(240);
  useEffect(() => {
    let alive = true;
    client.htmlPreview(source).then((value) => { if (alive) setId(value); }, () => undefined);
    return () => { alive = false; };
  }, [source]);
  useEffect(() => {
    if (!fit) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const next = Number((event.data as { sirusPreviewHeight?: unknown } | null)?.sirusPreviewHeight);
      if (Number.isFinite(next)) setHeight(Math.max(80, Math.min(720, next)));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [fit]);
  const style = fit ? { height } : undefined;
  return id
    ? <iframe ref={frame} title={t("htmlPreview.page")} src={`sirus-preview://localhost/${id}`} sandbox="allow-scripts allow-forms allow-modals" className={className ?? "html-preview-frame"} style={style} />
    : <div className={className ?? "html-preview-frame"} style={style} />;
}

/** An agent's HTML in the transcript (after T3 Code), with a toggle to its source. */
export function HtmlPreview({ source }: { source: string }) {
  const t = useTranslation();
  const [view, setView] = useState<"page" | "code">("page");
  return <div className="html-preview">
    <div className="html-preview-bar">
      <span className="ui-caption text-text-muted">HTML</span>
      <div className="html-preview-toggle" role="group" aria-label={t("htmlPreview.view")}>
        <button type="button" aria-pressed={view === "page"} onClick={() => setView("page")}><Eye size={13} aria-hidden="true" />{t("htmlPreview.page")}</button>
        <button type="button" aria-pressed={view === "code"} onClick={() => setView("code")}><Code size={13} aria-hidden="true" />{t("htmlPreview.code")}</button>
      </div>
    </div>
    {view === "code" ? <CodeBlock code={source} language="html" maxLines={18} animateChanges={false} /> : <HtmlPage source={source} fit />}
  </div>;
}
