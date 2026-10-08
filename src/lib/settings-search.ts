import type { SettingsIndexEntry } from "@/lib/settings-index";

export interface SettingsMatch { entry: SettingsIndexEntry; title: string; description: string | null; group: string | null }

const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();

/**
 * Settings rows whose translated title, description, group or page name contain every word
 * of the query (accents ignored); title matches first.
 */
export function searchSettings(index: readonly SettingsIndexEntry[], query: string, translate: (key: string) => string, pageName: (section: SettingsIndexEntry["section"]) => string): SettingsMatch[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = index.map((entry) => {
    const title = translate(entry.title);
    const description = entry.description ? translate(entry.description) : null;
    const group = entry.group ? translate(entry.group) : null;
    const haystack = fold([title, description, group, pageName(entry.section), entry.title, entry.description].filter(Boolean).join(" "));
    if (!words.every((word) => haystack.includes(word))) return null;
    const score = words.every((word) => fold(title).includes(word)) ? 0 : 1;
    return { match: { entry, title, description, group }, score };
  }).filter((item): item is { match: SettingsMatch; score: number } => item !== null);
  return scored.sort((a, b) => a.score - b.score).map((item) => item.match);
}
