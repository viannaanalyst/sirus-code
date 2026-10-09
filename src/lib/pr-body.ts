// Pull request bodies render as chat Markdown (ADR-102). GitHub bodies mix Markdown with a
// little HTML — template comments, <img> uploads, <br>, <details> — so that HTML is turned
// into the Markdown the chat renderer already understands; anything else stays plain text.

const attribute = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(2).find((value) => value !== undefined) ?? "";

/** Markdown for a PR body: template comments dropped, https images kept, layout tags unwrapped. */
export function prBodyMarkdown(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = attribute(tag, "src").trim();
      // The chat renderer shows https images only (img-src allows https:); others become nothing.
      if (!/^https:\/\//i.test(src)) return "";
      const alt = attribute(tag, "alt").replace(/[[\]]/g, "").trim();
      return `![${alt}](${src.replace(/[()\s]/g, encodeURIComponent)})`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:p|div|details|summary|picture|source|sub|sup|center|span)\b[^>]*>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
