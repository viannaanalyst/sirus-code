import type { AppSettings, MonoFontId } from "@/client/types";
export const SYSTEM_UI_FONT = 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", "Segoe UI", sans-serif';
const monoFallback = ', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
interface FontOption<T extends string> { id: T; label: string; family: string; installedOnly?: boolean; }
export const UI_FONTS: FontOption<AppSettings["uiFont"]>[] = [
  { id: "inter", label: "Inter", family: '"Inter Variable", sans-serif' },
  { id: "geist", label: "Geist", family: '"Geist Variable", sans-serif' },
  { id: "dmSans", label: "DM Sans", family: '"DM Sans Variable", sans-serif' },
  { id: "plexSans", label: "IBM Plex Sans", family: '"IBM Plex Sans", sans-serif' },
  { id: "humanist", label: "Humanist", family: '"Avenir Next", "Segoe UI", sans-serif', installedOnly: true },
  { id: "helvetica", label: "Helvetica", family: '"Helvetica Neue", Helvetica, Arial, sans-serif', installedOnly: true },
];
export const MONO_FONTS: FontOption<MonoFontId>[] = [
  { id: "plexMono", label: "IBM Plex Mono", family: '"IBM Plex Mono"' },
  { id: "jetbrains", label: "JetBrains Mono", family: '"JetBrains Mono Variable"' },
  { id: "fira", label: "Fira Code", family: '"Fira Code Variable"' },
  { id: "geistMono", label: "Geist Mono", family: '"Geist Mono Variable"' },
  { id: "source", label: "Source Code Pro", family: '"Source Code Pro Variable"' },
  { id: "roboto", label: "Roboto Mono", family: '"Roboto Mono Variable"' },
  { id: "ubuntu", label: "Ubuntu Mono", family: '"Ubuntu Mono"' },
  { id: "sfMono", label: "SF Mono", family: '"SF Mono"', installedOnly: true },
  { id: "menlo", label: "Menlo", family: 'Menlo', installedOnly: true },
  { id: "cascadia", label: "Cascadia Code", family: '"Cascadia Code"', installedOnly: true },
  { id: "hack", label: "Hack", family: 'Hack', installedOnly: true },
  { id: "consolas", label: "Consolas", family: 'Consolas', installedOnly: true },
];
export function uiFontFamily(settings: Pick<AppSettings, "systemUiFont" | "uiFont">): string {
  return settings.systemUiFont ? SYSTEM_UI_FONT : (UI_FONTS.find(font => font.id === settings.uiFont) ?? UI_FONTS[0]).family.replace(/, sans-serif$/, "") + ", " + SYSTEM_UI_FONT;
}
export function monoFontFamily(id: MonoFontId): string { return (MONO_FONTS.find(font => font.id === id) ?? MONO_FONTS[0]).family + monoFallback; }
