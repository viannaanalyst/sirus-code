import { useEffect, useRef, useState } from "react";
import { client } from "@/client";
import { Code, Eye } from "@/components/icons/phosphor";
import { CodeBlock } from "@/components/arc/code-block/code-block";
import { useTranslation } from "@/i18n/use-translation";

/**
 * An agent's HTML running in the transcript (after T3 Code): served on its own isolated
 * origin inside a sandboxed frame that fits its height, with a toggle to the source.
 */
export function HtmlPreview({ source }: { source: string }) {
  const t = useTranslation();
  const frame = useRef<HTMLIFrameElement>(null);
  const [view, setView] = useState<"page" | "code">("page");
  const [id, setId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [height, setHeight] = useState(240);
  useEffect(() => {
    let alive = true;
    client.htmlPreview(source).then((value) => { if (alive) setId(value); }, () => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [source]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const next = Number((event.data as { sirusPreviewHeight?: unknown } | null)?.sirusPreviewHeight);
      if (Number.isFinite(next)) setHeight(Math.max(80, Math.min(720, next)));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const showCode = view === "code" || failed;
  return <div className="html-preview">
    <div className="html-preview-bar">
      <span className="ui-caption text-text-muted">HTML</span>
      <div className="html-preview-toggle" role="group" aria-label={t("htmlPreview.view")}>
        <button type="button" aria-pressed={!showCode} disabled={failed} onClick={() => setView("page")}><Eye size={13} aria-hidden="true" />{t("htmlPreview.page")}</button>
        <button type="button" aria-pressed={showCode} onClick={() => setView("code")}><Code size={13} aria-hidden="true" />{t("htmlPreview.code")}</button>
      </div>
    </div>
    {showCode
      ? <CodeBlock code={source} language="html" maxLines={18} animateChanges={false} />
      : id ? <iframe ref={frame} title={t("htmlPreview.page")} src={`sirus-preview://localhost/${id}`} sandbox="allow-scripts allow-forms allow-modals" className="html-preview-frame" style={{ height }} />
      : <div className="html-preview-frame" style={{ height }} />}
  </div>;
}
