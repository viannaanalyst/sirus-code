import { memo, useEffect, useState } from "react";

type Katex = typeof import("katex").default;
let loading: Promise<Katex> | null = null;

/** Loads KaTeX and its stylesheet on the first formula only. */
function katex(): Promise<Katex> {
  loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([module]) => module.default);
  return loading;
}

/** Rendered markup per display mode and source, so a remount or a re-render never redraws. */
const rendered = new Map<string, string | null>();
const key = (tex: string, display: boolean) => `${display ? "D" : "I"}${tex}`;

function render(instance: Katex, tex: string, display: boolean): string | null {
  try {
    // Agent output is untrusted: `trust: false` refuses \href, \includegraphics and raw HTML
    // commands, and KaTeX escapes everything else. Invalid TeX falls back to its source.
    return instance.renderToString(tex, { displayMode: display, throwOnError: true, trust: false, strict: "ignore", output: "htmlAndMathml", maxSize: 50, maxExpand: 500 });
  } catch {
    return null;
  }
}

/**
 * A LaTeX formula from a reply (ADR-160), drawn by KaTeX. Until KaTeX loads, and when the
 * TeX does not parse, the source shows as inline code, so nothing is lost.
 */
export const MathFormula = memo(function MathFormula({ tex, display = false }: { tex: string; display?: boolean }) {
  const [html, setHtml] = useState(() => rendered.get(key(tex, display)));
  useEffect(() => {
    const id = key(tex, display);
    if (rendered.has(id)) { setHtml(rendered.get(id)); return; }
    let alive = true;
    void katex().then((instance) => {
      const markup = render(instance, tex, display);
      rendered.set(id, markup);
      if (rendered.size > 500) rendered.delete(rendered.keys().next().value!);
      if (alive) setHtml(markup);
    }, () => { if (alive) setHtml(null); });
    return () => { alive = false; };
  }, [tex, display]);
  if (!html) {
    const source = display ? `$$${tex}$$` : `$${tex}$`;
    return display ? <div className="chat-math-block"><code className="chat-inline-code">{source}</code></div> : <code className="chat-inline-code">{source}</code>;
  }
  // KaTeX's own escaped output (see `render`).
  return display
    ? <div className="chat-math-block scroll-thin" role="math" aria-label={tex} dangerouslySetInnerHTML={{ __html: html }} />
    : <span className="chat-math" role="math" aria-label={tex} dangerouslySetInnerHTML={{ __html: html }} />;
});
