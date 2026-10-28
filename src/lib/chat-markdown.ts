/**
 * Helpers for the links of assistant replies: local media, workspace file references.
 * The Markdown itself is parsed by react-markdown (ADR-179; `markdown-blocks.ts`,
 * `markdown-math.ts`, `markdown-pipeline.ts`).
 */

/** A link to an image file on the Mac (not the web): it opens in the gallery (ADR-085). */
export function isLocalImageLink(url: string): boolean {
  const value = url.trim();
  if (/^(?:[a-z][a-z0-9+.-]*:)(?!\/\/\/)/i.test(value) && !/^file:\/\/\//i.test(value)) return false;
  return /\.(?:png|jpe?g|gif|webp)$/i.test(value.replace(/[?#].*$/, ""));
}

/** A link to a video file on the Mac that macOS can play inline (ADR-119). */
export function isLocalVideoLink(url: string): boolean {
  const value = url.trim();
  if (/^(?:[a-z][a-z0-9+.-]*:)(?!\/\/\/)/i.test(value) && !/^file:\/\/\//i.test(value)) return false;
  return /\.(?:mp4|m4v|mov|webm)$/i.test(value.replace(/[?#].*$/, ""));
}

/** What a reply's local link shows inline (ADR-119): an image, a video, or nothing. */
export function localMediaKind(url: string): "image" | "video" | null {
  return isLocalImageLink(url) ? "image" : isLocalVideoLink(url) ? "video" : null;
}

/** The path the native side resolves for a local media link: no query or fragment. */
export function localMediaPath(url: string): string {
  return url.trim().replace(/[?#].*$/, "");
}

/**
 * A workspace file reference in inline code or a link target: a relative path
 * (or one inside `cwd`) with a name that looks like a file, optionally `:line`.
 */
export function fileReference(raw: string, cwd: string | null): { path: string; line: number | null } | null {
  let value = raw.trim().replace(/^["']|["']$/g, "");
  if (!value || value.length > 300 || /\s|:\/\//.test(value)) return null;
  if (value.startsWith("file://")) value = decodeURI(value.slice(7));
  const position = /:(\d+)(?::\d+)?$/.exec(value);
  const line = position ? Number(position[1]) : null;
  if (position) value = value.slice(0, position.index);
  value = value.replace(/#L(\d+).*$/, "");
  if (value.startsWith("/")) {
    if (!cwd || !value.startsWith(`${cwd.replace(/\/$/, "")}/`)) return null;
    value = value.slice(cwd.replace(/\/$/, "").length + 1);
  }
  value = value.replace(/^\.\//, "");
  if (!value || value.split("/").some((part) => part === ".." || part === "." || part === "")) {
    return value.endsWith("/") && !value.slice(0, -1).split("/").some((part) => !part || part === "..") ? { path: value.slice(0, -1), line } : null;
  }
  const name = value.split("/").pop()!;
  const looksLikeFile = /\.[A-Za-z][\w-]{0,9}$/.test(name) || /^(Makefile|Dockerfile|LICENSE|README|Gemfile|Procfile|\.env\.example|\.gitignore)$/.test(name);
  if (!looksLikeFile && !value.includes("/")) return null;
  if (!/^[\w@.+~-]+(\/[\w@.+~ -]+)*$/.test(value)) return null;
  return { path: value, line };
}
