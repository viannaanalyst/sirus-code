import { memo, useEffect, useId, useRef, useState } from "react";
import { CodeBlock } from "@/components/arc/code-block/code-block";
import { useTranslation } from "@/i18n/use-translation";
import { editorStyleNonce } from "@/lib/editor-nonce";
import "@/styles/mermaid.css";

/** Diagram source above this size stays a code block. */
const MAX_SOURCE = 20_000;

type Mermaid = typeof import("mermaid").default;
let loading: Promise<Mermaid> | null = null;
let configuredTheme: string | null = null;

/** Loads Mermaid on first use only (it is a large chunk) in its strict mode. */
async function mermaid(theme: "dark" | "default"): Promise<Mermaid> {
  loading ??= import("mermaid").then((module) => module.default);
  const instance = await loading;
  if (configuredTheme !== theme) {
    // Agent output is untrusted: strict mode sanitizes labels and drops click handlers and HTML labels.
    instance.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, theme, htmlLabels: false, flowchart: { htmlLabels: false }, maxTextSize: MAX_SOURCE, fontFamily: "inherit" });
    configuredTheme = theme;
  }
  return instance;
}

/**
 * A fenced ```mermaid block drawn as a diagram, with a toggle back to the
 * source. Mermaid embeds a <style> in its SVG; the SVG is parsed first and
 * that style gets the page's existing CSP nonce, so CSP is never relaxed.
 * Anything Mermaid cannot draw falls back to the code block.
 */
export const MermaidDiagram = memo(function MermaidDiagram({ source }: { source: string }) {
  const t = useTranslation();
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    if (source.length > MAX_SOURCE) { setState("failed"); return; }
    let cancelled = false;
    const theme = document.documentElement.dataset.theme === "light" ? "default" : "dark";
    void (async () => {
      try {
        const instance = await mermaid(theme);
        const { svg } = await instance.render(`mermaid-${id}`, source);
        if (cancelled || !host.current) return;
        const parsed = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
        if (parsed.nodeName !== "svg") throw new Error("not svg");
        const nonce = editorStyleNonce(document);
        parsed.querySelectorAll("style").forEach((style) => { if (nonce) style.setAttribute("nonce", nonce); else style.remove(); });
        parsed.removeAttribute("height");
        parsed.setAttribute("role", "img");
        host.current.replaceChildren(document.importNode(parsed, true));
        setState("ready");
      } catch {
        // Mermaid leaves an error element behind when parsing fails.
        document.getElementById(`dmermaid-${id}`)?.remove();
        if (!cancelled) setState("failed");
      }
    })();
    return () => { cancelled = true; };
  }, [id, source]);

  if (state === "failed") return <CodeBlock code={source} language="mermaid" animateChanges={false} />;
  return <figure className="mermaid-diagram">
    <div className="mermaid-diagram-bar ui-caption">
      <span>{t("diagram.label")}</span>
      <button type="button" className="mermaid-diagram-toggle" aria-pressed={showSource} onClick={() => setShowSource((value) => !value)}>{t(showSource ? "diagram.showDiagram" : "diagram.showSource")}</button>
    </div>
    {showSource ? <CodeBlock code={source} language="mermaid" animateChanges={false} /> : null}
    <div ref={host} className="mermaid-diagram-canvas" hidden={showSource} aria-busy={state === "loading"} aria-label={t("diagram.label")} />
  </figure>;
});
