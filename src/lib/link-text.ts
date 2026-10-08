export type LinkSegment = { kind: "text"; text: string } | { kind: "link"; text: string; url: string };

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;
/** Closing punctuation that ends a sentence rather than the address. */
const TRAILING = /[.,;:!?)\]}'"»”]+$/;

/** Splits plain text into text and http(s) link segments, trimming sentence punctuation off links. */
export function splitLinks(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    let url = match[0];
    // Keep a closing parenthesis that belongs to the URL (Wikipedia-style addresses).
    const trailing = TRAILING.exec(url)?.[0] ?? "";
    if (trailing) {
      const balanced = trailing.startsWith(")") && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0);
      url = balanced ? url : url.slice(0, url.length - trailing.length);
    }
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ kind: "text", text: text.slice(cursor, start) });
    segments.push({ kind: "link", text: url, url });
    cursor = start + url.length;
  }
  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments;
}
