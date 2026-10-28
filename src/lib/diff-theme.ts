// Syntax themes and surface styles for diffs rendered with @pierre/diffs (ADR-169). The dark
// theme is Pierre's own; the light one is pierre-light with each syntax colour darkened until it
// reads on the tinted added and removed rows of a light surface. Themes resolve on the main
// thread and reach the diff workers already resolved.
import { getResolvedOrResolveTheme, registerCustomTheme, type DiffsTheme } from "@pierre/diffs";
import { importedSyntax } from "./code-theme-state";

export const DIFF_THEME_NAMES = { light: "sirus-light", dark: "pierre-dark" } as const;
export type DiffAppearance = keyof typeof DIFF_THEME_NAMES;

const registeredImports = new Set<string>();
/** The syntax theme for an appearance: the imported VS Code theme in use (ADR-185), registered on first ask, or Sirus's own. */
export function diffThemeName(appearance: DiffAppearance): string {
  const imported = importedSyntax(appearance);
  if (!imported) return DIFF_THEME_NAMES[appearance];
  if (!registeredImports.has(imported.name)) {
    registeredImports.add(imported.name);
    registerCustomTheme(imported.name, async () => imported.zed as unknown as NonNullable<DiffsTheme["zed"]>, "zed");
  }
  return imported.name;
}

const MIN_CONTRAST = 4.5;
/** Luminance of the darkest light row: a removed line's tint over a near-white surface, rounded down. */
const DARKEST_SURFACE_LUMINANCE = 0.78;

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrastOnLightRows(rgb: readonly number[]): number {
  const [r, g, b] = rgb.map(channelLuminance);
  return (DARKEST_SURFACE_LUMINANCE + 0.05) / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

/** A #rrggbb(aa) colour darkened, hue kept, until it has `minContrast` on light rows; other values pass through. */
export function readableOnLightRows(color: string, minContrast = MIN_CONTRAST): string {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (!match) return color;
  let rgb = [0, 2, 4].map((start) => Number.parseInt(match[1].slice(start, start + 2), 16));
  if (contrastOnLightRows(rgb) >= minContrast) return color;
  while (contrastOnLightRows(rgb) < minContrast) rgb = rgb.map((channel) => Math.floor(channel * 0.96));
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}${match[2] ?? ""}`;
}

type ZedTheme = NonNullable<DiffsTheme["zed"]>;

function readableSyntax(theme: ZedTheme): ZedTheme {
  const syntax = Object.fromEntries(Object.entries(theme.style.syntax ?? {}).map(([scope, style]) => [
    scope,
    typeof style === "string" ? readableOnLightRows(style)
      : style.color ? { ...style, color: readableOnLightRows(style.color) } : style,
  ]));
  return { ...theme, name: DIFF_THEME_NAMES.light, style: { ...theme.style, syntax } };
}

let registered = false;
/** Registers the light theme once; call before a worker pool or viewer asks for it. */
export function registerDiffThemes() {
  if (registered) return;
  registered = true;
  registerCustomTheme(DIFF_THEME_NAMES.light, async () => {
    const base = await getResolvedOrResolveTheme("pierre-light", "highlights");
    if (!base.zed) throw new Error("pierre-light has no Highlights palette");
    return readableSyntax(base.zed);
  }, "zed");
}

/**
 * Injected into every Pierre shadow root. Surfaces, added and removed rows come from the app
 * tokens (`--success` and `--danger` mixed over the pane), and code takes the code font setting.
 * `--sirus-diff-surface` is set on the viewer's wrapper.
 */
export const DIFF_UNSAFE_CSS = `
:host, [data-diffs-header], [data-diff], [data-file], [data-error-wrapper], [data-virtualizer-buffer] {
  --diffs-font-family: var(--code-font-family) !important;
  --diffs-font-size: var(--code-font-size) !important;
  --diffs-header-font-family: var(--font-sans) !important;
  --diffs-bg: var(--sirus-diff-surface) !important;
  --diffs-light-bg: var(--sirus-diff-surface) !important;
  --diffs-dark-bg: var(--sirus-diff-surface) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;
  --diffs-fg-number-override: var(--text-muted);
  --diffs-bg-context-override: var(--sirus-diff-surface);
  --diffs-bg-hover-override: color-mix(in srgb, var(--sirus-diff-surface) 93%, var(--text-primary));
  --diffs-bg-separator-override: color-mix(in srgb, var(--sirus-diff-surface) 95%, var(--text-primary));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--sirus-diff-surface) 94%, var(--text-primary));
  --diffs-bg-addition-override: color-mix(in srgb, var(--success) 11%, var(--sirus-diff-surface));
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--success) 17%, var(--sirus-diff-surface));
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--success) 16%, var(--sirus-diff-surface));
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--success) 27%, var(--sirus-diff-surface));
  --diffs-bg-deletion-override: color-mix(in srgb, var(--danger) 11%, var(--sirus-diff-surface));
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--danger) 17%, var(--sirus-diff-surface));
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--danger) 16%, var(--sirus-diff-surface));
  --diffs-bg-deletion-emphasis-override: color-mix(in srgb, var(--danger) 27%, var(--sirus-diff-surface));
  --diffs-addition-color-override: var(--success);
  --diffs-deletion-color-override: var(--danger);
  --diffs-modified-color-override: var(--info);
  --diffs-bg-selection-override: color-mix(in srgb, var(--accent) 18%, var(--sirus-diff-surface));
  --diffs-bg-selection-number-override: color-mix(in srgb, var(--accent) 26%, var(--sirus-diff-surface));
  background-color: var(--diffs-bg) !important;
  color: var(--text-primary) !important;
}
[data-diffs-header] {
  position: sticky !important; top: 0; z-index: 4;
  height: 36px !important; min-height: 36px !important; padding-block: 0 !important; padding-inline: 4px 12px !important;
  align-items: center !important; line-height: 1 !important;
  background-color: var(--background-2) !important;
  border-bottom: 1px solid var(--border-subtle) !important;
  font-size: var(--text-ui-12, 12px) !important;
}
[data-diffs-header] :is([data-header-content], [data-metadata]) { align-items: center !important; line-height: 1 !important; }
[data-diffs-header] :is([data-title], [data-prev-name]) { line-height: 16px !important; font-family: var(--code-font-family) !important; font-size: var(--text-ui-12, 12px) !important; color: var(--text-primary) !important; }
[data-diffs-header] :is([data-additions-count], [data-deletions-count]) { font-family: var(--code-font-family) !important; font-size: var(--text-ui-11, 11px) !important; font-variant-numeric: tabular-nums; line-height: 1 !important; }
[data-diffs-header] [data-additions-count] { color: var(--success) !important; }
[data-diffs-header] [data-deletions-count] { color: var(--danger) !important; }
[data-diffs-header] [data-change-icon] { display: block; flex-shrink: 0; }
[data-change-icon="new"] { color: var(--success) !important; }
[data-change-icon="deleted"] { color: var(--danger) !important; }
[data-change-icon="change"], [data-change-icon="rename-pure"], [data-change-icon="rename-changed"] { color: var(--info) !important; }
:is([data-separator="line-info"], [data-separator="line-info-basic"]) {
  height: 24px !important; margin-block: 0 !important;
  --diffs-bg-separator: color-mix(in srgb, var(--sirus-diff-surface) 96%, var(--text-primary));
}
:is([data-separator="line-info"], [data-separator="line-info-basic"]) :is([data-separator-content], [data-expand-button]) { color: var(--text-muted) !important; font-family: var(--font-sans) !important; font-size: var(--text-ui-11, 11px) !important; }
::highlight(sirus-find) { background-color: color-mix(in srgb, var(--accent) 30%, transparent); color: inherit; }
::highlight(sirus-find-current) { background-color: color-mix(in srgb, var(--accent) 62%, transparent); color: inherit; }
[data-line][data-sirus-find-line] { box-shadow: inset 2px 0 0 var(--accent); }
[data-diff], [data-file] { transition: opacity var(--motion-normal) var(--ease-out); }
@starting-style { [data-diff], [data-file] { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { [data-diff], [data-file] { transition: none; } }
`;
