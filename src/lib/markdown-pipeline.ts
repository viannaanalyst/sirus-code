// The plugins and URL rules of the reply Markdown pipeline (ADR-179): react-markdown with
// remark-gfm, remark-math and remark-breaks, as T3 Code's ChatMarkdown does (MIT). Pure, so the
// rules are tested without React. Raw HTML is never enabled (no rehype-raw): react-markdown
// shows it as text, so nothing here can inject markup.
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";

/** Single line breaks stay line breaks, as agents write them. */
export const REMARK_PLUGINS: PluggableList = [remarkGfm, [remarkMath, { singleDollarTextMath: true }], remarkBreaks];

const SAFE_SCHEME = /^(?:https?|mailto|tel|file):/i;
const IMAGE_DATA = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i;

/**
 * Which link and image targets survive: web, mail, `file:` and scheme-less paths (workspace
 * and local files, ADR-085/119). Anything else, `javascript:` and `data:` included, is
 * dropped; only a base64 raster image keeps `data:`, and only as an image source.
 */
export function urlTransform(url: string, key?: string): string {
  const value = url.trim();
  if (!value) return "";
  if (key === "src" && IMAGE_DATA.test(value)) return value;
  if (SAFE_SCHEME.test(value)) return value;
  // A colon before any slash, query or fragment is a scheme; everything else is a path.
  return /^[^/?#]*:/.test(value) ? "" : value;
}

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** Elements whose text never fades: it is not prose that is being typed. */
const NO_FADE = new Set(["a", "code", "pre", "table", "svg"]);

/**
 * Marks the last text of a streaming block (`<span data-stream-tail>`), so the renderer fades
 * only the words that just arrived (ADR-119). The last piece of text decides: if it sits in
 * a link or code, nothing fades.
 */
export function rehypeStreamTail() {
  return (tree: HastNode) => {
    const walk = (node: HastNode, blocked: boolean): boolean => {
      if (node.type === "text" && node.value?.trim()) return true;
      const children = node.children;
      if (!children) return false;
      const stop = blocked || (node.type === "element" && NO_FADE.has(node.tagName ?? ""));
      for (let at = children.length - 1; at >= 0; at -= 1) {
        const child = children[at];
        if (!walk(child, stop)) continue;
        if (child.type === "text" && !stop) {
          children[at] = { type: "element", tagName: "span", properties: { dataStreamTail: "" }, children: [child] };
        }
        return true;
      }
      return false;
    };
    walk(tree, false);
  };
}

export const TAIL_REHYPE_PLUGINS: PluggableList = [rehypeStreamTail];
export const NO_REHYPE_PLUGINS: PluggableList = [];
