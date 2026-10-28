// Renders reply Markdown with the production pipeline and react-markdown's plain elements, so tests
// see the markup the plugins produce without the app's components (which need the Tauri client).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { prepareMath } from "../src/lib/markdown-math.ts";
import { REMARK_PLUGINS, TAIL_REHYPE_PLUGINS, urlTransform } from "../src/lib/markdown-pipeline.ts";

export function renderMarkdown(source: string, options: { tail?: boolean } = {}): string {
  return renderToStaticMarkup(createElement(Markdown, {
    remarkPlugins: REMARK_PLUGINS,
    rehypePlugins: options.tail ? TAIL_REHYPE_PLUGINS : [],
    urlTransform,
    children: prepareMath(source),
  }));
}
