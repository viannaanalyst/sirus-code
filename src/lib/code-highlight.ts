// Syntax colours for code in replies, from @pierre/diffs' shared highlighter (ADR-169, ADR-179),
// as T3 Code does (MIT). Pierre loads on the first code block (never in the main bundle), the
// "highlights" engine tokenizes with hand-written WASM lexers, and results are cached per
// source, language and appearance, so a remount or a re-render never tokenizes again.
// Anything Pierre cannot colour (unknown language, too long, failure) returns null and the
// caller keeps the lightweight regex colours.
import { codeThemeKey } from "./code-theme-state";
export interface HighlightedToken { content: string; color?: string; fontStyle?: number }
export type HighlightedLines = HighlightedToken[][];
export type CodeAppearance = "light" | "dark";

/** Tokenizing runs on the main thread: sources over this size keep the regex colours. */
export const PIERRE_MAX_CHARS = 40_000;
const CACHE_LIMIT = 200;

const cache = new Map<string, HighlightedLines>();
const unsupported = new Set<string>();
const pending = new Map<string, Promise<HighlightedLines | null>>();

const keyOf = (code: string, language: string, appearance: CodeAppearance) => `${appearance}\0${codeThemeKey(appearance)}\0${language}\0${code}`;

/** Languages Pierre has no grammar for and plain text are not coloured by it. */
export function pierreLanguage(language: string): string | null {
  const value = language.toLowerCase().replace(/^\./, "");
  return !value || value === "text" || value === "txt" || value === "plain" || value === "plaintext" || unsupported.has(value) ? null : value;
}

export function cachedHighlight(code: string, language: string, appearance: CodeAppearance): HighlightedLines | undefined {
  return cache.get(keyOf(code, language, appearance));
}

type Highlighter = Awaited<ReturnType<(typeof import("@pierre/diffs"))["getSharedHighlighter"]>>;
let highlighter: Promise<{ shared: typeof import("@pierre/diffs"); themes: typeof import("./diff-theme") }> | null = null;

function load() {
  highlighter ??= Promise.all([import("@pierre/diffs"), import("./diff-theme")]).then(([shared, themes]) => {
    themes.registerDiffThemes();
    return { shared, themes };
  });
  return highlighter;
}

/** The colours of `code` in `language`, or null when Pierre cannot colour it. */
export function highlightCode(code: string, language: string, appearance: CodeAppearance): Promise<HighlightedLines | null> {
  const lang = pierreLanguage(language);
  if (!lang || code.length > PIERRE_MAX_CHARS) return Promise.resolve(null);
  const key = keyOf(code, lang, appearance);
  const known = cache.get(key);
  if (known) return Promise.resolve(known);
  const running = pending.get(key);
  if (running) return running;
  const job = load().then(async ({ shared, themes }) => {
    const names = { light: themes.diffThemeName("light"), dark: themes.diffThemeName("dark") };
    const highlight: Highlighter = await shared.getSharedHighlighter({ themes: [names.light, names.dark], langs: [lang], preferredHighlighter: "highlights" });
    const result = highlight.codeToTokens(code, { lang, theme: names[appearance] });
    const lines = result.tokens as HighlightedLines;
    cache.set(key, lines);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    return lines;
  }).catch(() => {
    // A language without a grammar is remembered, so it is not asked for again on every delta.
    unsupported.add(lang);
    return null;
  }).finally(() => { pending.delete(key); });
  pending.set(key, job);
  return job;
}
