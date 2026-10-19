/**
 * Release notes as written for a release (`npm run release -- … --notes`), read into sections
 * for the update panel and What's new (ADR-140): `#`/`##`/`###` lines start a section, `-`/`*`
 * lines are its items, any other line is an item of its own. No HTML, no links: plain text.
 */
export interface ReleaseNotesSection {
  title: string | null;
  items: string[];
}

export function parseReleaseNotes(notes: string | null | undefined): ReleaseNotesSection[] {
  const sections: ReleaseNotesSection[] = [];
  let current: ReleaseNotesSection | null = null;
  for (const raw of (notes ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      current = { title: clean(heading[1]), items: [] };
      sections.push(current);
      continue;
    }
    const item = clean(line.replace(/^([-*•]|\d+[.)])\s+/, ""));
    if (!item) continue;
    if (!current) { current = { title: null, items: [] }; sections.push(current); }
    current.items.push(item);
  }
  return sections.filter(section => section.items.length > 0);
}

/** Markdown emphasis and code marks dropped, spaces collapsed. */
function clean(text: string): string {
  return text.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
}

/** How many items the notes list, for "and N more" summaries. */
export function releaseNotesCount(sections: readonly ReleaseNotesSection[]): number {
  return sections.reduce((sum, section) => sum + section.items.length, 0);
}
