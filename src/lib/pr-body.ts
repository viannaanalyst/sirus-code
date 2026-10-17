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

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const USER_ATTACHMENT = new RegExp(`^https://github\\.com/user-attachments/assets/(${UUID})$`, "i");
const REPO_ATTACHMENT = new RegExp(`^https://github\\.com/([A-Za-z0-9-]{1,100}/[A-Za-z0-9._-]{1,100})/assets/(\\d{1,12})/(${UUID})$`, "i");

/**
 * The ID of a GitHub image upload (`<uuid>`, or `<number>/<uuid>` for an older upload of
 * this repository) that may need the person's GitHub login to load. Other URLs give null
 * and load like any https image (ADR-102).
 */
export function githubAttachmentAsset(url: string, repository: string): string | null {
  const user = USER_ATTACHMENT.exec(url);
  if (user) return user[1].toLowerCase();
  const repo = REPO_ATTACHMENT.exec(url);
  return repo && repo[1].toLowerCase() === repository.toLowerCase() ? `${repo[2]}/${repo[3].toLowerCase()}` : null;
}

/** The distinct GitHub uploads among a Markdown text's images, at most `limit`. */
export function githubAttachmentAssets(markdown: string, repository: string, limit = 12): string[] {
  const assets = new Set<string>();
  for (const match of markdown.matchAll(/!\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const asset = githubAttachmentAsset(match[1], repository);
    if (asset) assets.add(asset);
    if (assets.size >= limit) break;
  }
  return [...assets];
}
