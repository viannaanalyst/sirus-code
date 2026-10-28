// Maps an imported VS Code colour theme onto Sirus (ADR-185): the Glass palette tokens, the code
// highlighter's syntax colours and the terminal palette. The back end hands over only the colours
// and token rules listed in `vscode_theme.rs`; everything here is a pure function of that value.
// Every text colour passes a contrast guard against the surfaces it sits on, so a theme with a
// pale comment or a dim foreground still reads. Glass translucency is applied by the existing
// materials on top of these tokens, so nothing here touches opacity.
import type { AppSettings, VsCodeTheme, VsCodeTokenRule } from "@/client/types";
import { contrast, ensureContrast, flatten, formatColor, mix, parseColor, withAlpha, type Rgba } from "./color-math";

/** Properties set on the document root while a theme is in use; all are removed with it. */
export const THEME_TOKEN_NAMES = [
  "--background-0", "--background-1", "--background-2", "--background-3", "--background-elevated", "--glass", "--sidebar-base",
  "--border-subtle", "--border-default", "--tree-line", "--chip-text", "--chip-hover", "--chip-selected",
  "--text-primary", "--text-secondary", "--text-muted", "--sidebar-rail-icon-active",
  "--accent", "--accent-hover", "--accent-muted", "--danger", "--success", "--warning", "--info", "--merged", "--switch-track-on",
] as const;

/** Minimum contrast ratios. Body text matches WCAG AA; UI glyphs and dim text have their own floors. */
export const CONTRAST = { primary: 7, secondary: 5, muted: 4.5, accent: 4.5, status: 4.5, syntax: 5, comment: 3.2, ansi: 3, ansiExtreme: 2, cursor: 3 } as const;

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
/** Sirus's own surfaces, used when a theme leaves a colour out. */
const FALLBACK = {
  dark: { background: "#0e0e11", foreground: "#ececf0", accent: "#a99cff", danger: "#f0645a", success: "#4fd69b", warning: "#e8b849", info: "#6ea0f5", merged: "#b588f0" },
  light: { background: "#ffffff", foreground: "#1f1f24", accent: "#5b45c9", danger: "#c8372d", success: "#2c7d4c", warning: "#9a6a12", info: "#2d62b8", merged: "#7c3fc4" },
} as const;

export type Palette = "light" | "dark";
export interface SyntaxStyle { color?: string; font_style?: "italic"; font_weight?: number }
export interface TerminalColors {
  background: string; foreground: string; cursor: string; selectionBackground: string;
  black: string; red: string; green: string; yellow: string; blue: string; magenta: string; cyan: string; white: string;
  brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string; brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string;
}
export interface MappedTheme {
  id: string;
  name: string;
  kind: Palette;
  /** Custom properties for the document root. */
  css: Record<string, string>;
  /** Terminal colours the theme defines (guarded); the rest stay Sirus's. */
  terminal: Partial<TerminalColors>;
  /** The code highlighter's palette in Zed's shape, which Pierre's "highlights" engine reads. */
  syntax: { background: string; text: string; syntax: Record<string, SyntaxStyle> };
  /** What the picker draws. */
  swatches: { background: string; surface: string; text: string; muted: string; accent: string; border: string };
}

const channel = (colors: Record<string, string>, ...keys: string[]): Rgba | null => {
  for (const key of keys) {
    const parsed = parseColor(colors[key]);
    if (parsed) return parsed;
  }
  return null;
};
const css = (color: Rgba) => formatColor(color);

// ---------------------------------------------------------------------------------------------
// Surfaces, text, accent and status
// ---------------------------------------------------------------------------------------------

export function mapPalette(theme: VsCodeTheme): { css: Record<string, string>; surfaces: { bg0: Rgba; bg1: Rgba; bg2: Rgba; bg3: Rgba }; text: Rgba; accent: Rgba; danger: Rgba; success: Rgba; border: Rgba } {
  const kind = theme.kind;
  const fallback = FALLBACK[kind];
  const colors = theme.colors;
  const base = parseColor(fallback.background)!;
  const bg0 = flatten(channel(colors, "editor.background") ?? base, base);
  const ink = kind === "dark" ? WHITE : BLACK;
  const step = (from: Rgba, amount: number) => mix(from, ink, amount);
  const flat = (color: Rgba | null) => (color ? flatten(color, bg0) : null);
  // Panels one step off the editor; a theme that gives the sidebar its own colour keeps it.
  const bg1 = flat(channel(colors, "sideBar.background")) ?? step(bg0, 0.025);
  const bg2 = step(bg1, 0.035);
  const bg3 = step(bg1, 0.085);
  const elevated = flat(channel(colors, "editorWidget.background", "menu.background", "dropdown.background", "quickInput.background")) ?? step(bg0, kind === "dark" ? 0.045 : 0);
  const surfaces = [bg0, bg1, bg2, bg3, elevated];

  // Text: the theme's foreground, lifted until it reads on every surface it can sit on.
  const rawText = flat(channel(colors, "foreground", "editor.foreground", "sideBar.foreground")) ?? parseColor(fallback.foreground)!;
  const primary = ensureContrast(rawText, surfaces, CONTRAST.primary);
  const secondaryRaw = mix(primary, bg0, 0.22);
  const secondary = ensureContrast(secondaryRaw, surfaces, CONTRAST.secondary);
  const mutedRaw = flat(channel(colors, "descriptionForeground")) ?? mix(primary, bg0, 0.42);
  const muted = ensureContrast(mutedRaw, [bg0, bg1, bg2, bg3], CONTRAST.muted);

  // Hairlines are ink tints, as in the Sirus palettes; a theme's own border is used when it shows.
  const themeBorder = flat(channel(colors, "sideBar.border", "panel.border", "editorGroup.border", "contrastBorder"));
  const borderDefault = themeBorder && contrast(themeBorder, bg0) >= 1.15 ? themeBorder : null;

  const guard = (value: Rgba | null, fallbackHex: string, minimum: number) => {
    const color = value ? flatten(value, bg0) : parseColor(fallbackHex)!;
    return ensureContrast(color, [bg0, bg1, bg2], minimum);
  };
  const accent = guard(channel(colors, "button.background", "focusBorder", "textLink.foreground", "charts.purple"), fallback.accent, CONTRAST.accent);
  const accentHover = mix(accent, primary, 0.14);
  const danger = guard(channel(colors, "editorError.foreground", "errorForeground", "terminal.ansiRed", "charts.red"), fallback.danger, CONTRAST.status);
  const success = guard(channel(colors, "editorGutter.addedBackground", "terminal.ansiGreen", "charts.green"), fallback.success, CONTRAST.status);
  const warning = guard(channel(colors, "editorWarning.foreground", "terminal.ansiYellow", "charts.yellow", "charts.orange"), fallback.warning, CONTRAST.status);
  const info = guard(channel(colors, "editorInfo.foreground", "terminal.ansiBlue", "charts.blue"), fallback.info, CONTRAST.status);
  const merged = guard(channel(colors, "charts.purple", "terminal.ansiMagenta"), fallback.merged, CONTRAST.status);

  const tint = (alpha: number) => css(withAlpha(primary, alpha));
  const light = kind === "light";
  const tokens: Record<string, string> = {
    "--background-0": css(bg0), "--background-1": css(bg1), "--background-2": css(bg2), "--background-3": css(bg3),
    "--background-elevated": css(elevated), "--glass": css(bg1), "--sidebar-base": css(bg1),
    "--border-subtle": tint(0.08), "--border-default": borderDefault ? css(borderDefault) : tint(light ? 0.14 : 0.115),
    "--tree-line": tint(0.14), "--chip-text": css(secondary), "--chip-hover": tint(0.06), "--chip-selected": tint(0.1),
    "--text-primary": css(primary), "--text-secondary": css(secondary), "--text-muted": css(muted),
    "--sidebar-rail-icon-active": css(primary),
    "--accent": css(accent), "--accent-hover": css(accentHover), "--accent-muted": css(withAlpha(accent, light ? 0.1 : 0.14)),
    "--danger": css(danger), "--success": css(success), "--warning": css(warning), "--info": css(info), "--merged": css(merged),
  };
  // The light palette's switch is a dark ink track; derive it from the accent instead of a fixed grey.
  if (light) tokens["--switch-track-on"] = css(mix(accent, bg3, 0.2));
  return { css: tokens, surfaces: { bg0, bg1, bg2, bg3 }, text: primary, accent, danger, success, border: borderDefault ?? mix(bg0, primary, light ? 0.14 : 0.12) };
}

// ---------------------------------------------------------------------------------------------
// Syntax
// ---------------------------------------------------------------------------------------------

/** TextMate scopes that stand for each role, most specific first. */
const ROLE_SCOPES: Record<string, string[]> = {
  comment: ["comment"],
  docComment: ["comment.block.documentation", "comment.block.javadoc", "comment"],
  string: ["string.quoted", "string"],
  escape: ["constant.character.escape", "string"],
  regex: ["string.regexp", "string"],
  special: ["constant.character", "string.other", "string"],
  symbol: ["constant.other.symbol", "string"],
  template: ["string.template", "string"],
  number: ["constant.numeric", "constant"],
  constant: ["constant.language", "variable.other.constant", "constant"],
  boolean: ["constant.language.boolean", "constant.language", "constant"],
  color: ["constant.other.color", "support.constant.color", "constant.numeric"],
  keyword: ["keyword.control", "keyword", "storage.modifier", "storage"],
  operator: ["keyword.operator", "keyword"],
  important: ["keyword.other.important", "keyword"],
  function: ["entity.name.function", "meta.function-call", "support.function"],
  builtinFunction: ["support.function", "entity.name.function"],
  type: ["entity.name.type", "support.type", "entity.name.class", "storage.type"],
  builtinType: ["support.type.primitive", "support.type.builtin", "storage.type", "entity.name.type"],
  className: ["entity.name.class", "entity.name.type.class", "support.class", "entity.name.type"],
  variable: ["variable.other", "variable"],
  builtinVariable: ["variable.language", "constant.language", "variable"],
  parameter: ["variable.parameter", "variable"],
  property: ["variable.other.property", "variable.other.object.property", "support.type.property-name", "meta.object-literal.key", "variable"],
  tag: ["entity.name.tag", "meta.tag", "markup.tag"],
  attribute: ["entity.other.attribute-name", "entity.other.attribute"],
  selector: ["entity.other.attribute-name.class.css", "entity.other.attribute-name", "entity.name.tag"],
  directive: ["keyword.control.at-rule", "keyword.other", "meta.preprocessor", "keyword"],
  punctuation: ["punctuation", "meta.brace"],
  decorator: ["meta.decorator", "entity.name.function.decorator", "punctuation.decorator", "storage.type.annotation"],
  namespace: ["entity.name.namespace", "entity.name.type.module", "support.other.namespace"],
  label: ["entity.name.label", "constant.other.label"],
  heading: ["markup.heading", "entity.name.section", "markup.heading.markdown"],
  bold: ["markup.bold"],
  italic: ["markup.italic"],
  strike: ["markup.strikethrough"],
  link: ["markup.underline.link", "string.other.link", "markup.link"],
  quote: ["markup.quote"],
  raw: ["markup.inline.raw", "markup.fenced_code", "markup.raw"],
  plus: ["markup.inserted"],
  minus: ["markup.deleted"],
  delta: ["markup.changed"],
  enum: ["variable.other.enummember", "constant.other.enum", "entity.name.type.enum"],
};

/** The highlighter's keys (Pierre's "highlights" palette) and the role each one takes. */
const KEY_ROLES: Record<string, string> = {
  comment: "comment", "comment.doc": "docComment",
  string: "string", "string.escape": "escape", "string.regex": "regex", "string.special": "special", "string.special.symbol": "symbol", "string.plain": "string", "string.template": "template", template_string: "template",
  number: "number", "number.unit": "number", unit: "number", constant: "constant", "constant.css": "constant", "constant.color": "color", color: "color", boolean: "boolean", value: "number", plain_value: "number",
  keyword: "keyword", "keyword.operator": "operator", "keyword.directive": "directive", "keyword.control.at-rule": "directive", at_keyword: "directive", "keyword.important": "important", operator: "operator",
  function: "function", "function.method": "function", "function.builtin": "builtinFunction", "function.special.definition": "function", "function.call": "function", "function.method.call": "function", method_definition: "function",
  type: "type", "type.builtin": "builtinType", "type.class": "className", constructor: "className", class: "className", class_name: "className", enum: "enum", variant: "enum",
  variable: "variable", "variable.builtin": "builtinVariable", "variable.member": "property", "variable.parameter": "parameter", "variable.special": "builtinVariable", "variable.language": "builtinVariable", "variable.scss": "variable", "variable.css": "variable", this: "builtinVariable", self: "builtinVariable",
  property: "property", "property.css": "property", "property.definition": "property", property_name: "property", "property.custom": "property", "property.object": "property", property_identifier: "property", shorthand_property_identifier: "property", shorthand_property_identifier_pattern: "property",
  "tag.css": "tag", tag_name: "tag", tag: "tag", "tag.jsx": "tag", "tag.component": "className",
  "selector.class": "className", "selector.id": "function", id_name: "function", "selector.pseudo": "operator", pseudo_class_selector: "operator", pseudo_element_selector: "operator", selector: "selector",
  attribute: "attribute", "attribute.builtin": "attribute", label: "label", namespace: "namespace", decorator: "decorator", embedded: "variable", preproc: "directive",
  punctuation: "punctuation", "punctuation.bracket": "punctuation", "punctuation.delimiter": "punctuation", "punctuation.list_marker": "punctuation", "punctuation.special": "punctuation",
  "text.literal": "raw", "markup.heading": "heading", title: "heading", "markup.bold": "bold", "emphasis.strong": "bold", "markup.italic": "italic", emphasis: "italic", "markup.strikethrough": "strike",
  "markup.link.url": "link", link_uri: "link", "markup.link.text": "link", link_text: "link", "markup.quote": "quote",
  "markup.list": "punctuation", "markup.list.numbered": "punctuation", "markup.list.unnumbered": "punctuation",
  "markup.raw": "raw", "markup.raw.inline": "raw", "markup.raw.block": "raw",
  "diff.plus": "plus", "diff.minus": "minus", "diff.delta": "delta", primary: "variable", predictive: "comment", hint: "comment",
};

interface Resolved { foreground?: string; fontStyle?: string }

/**
 * TextMate precedence for one scope: for each property the most specific matching rule wins
 * (longer selector, then the later rule). Rules without a scope (the theme's default text) never
 * match here; `mapSyntax` reads them on their own.
 */
export function resolveScope(rules: readonly VsCodeTokenRule[], target: string): Resolved {
  let foreground: { weight: number; value: string } | undefined;
  let fontStyle: { weight: number; value: string } | undefined;
  rules.forEach((rule, index) => {
    for (const selector of rule.scope) {
      // A selector with ancestors ("source.css entity.name.tag") is judged by its last part, a little weaker.
      const atoms = selector.trim().split(/\s+/);
      const atom = atoms[atoms.length - 1];
      if (!atom || atom.startsWith("-") || (target !== atom && !target.startsWith(`${atom}.`))) continue;
      const weight = atom.split(".").length * 1000 - (atoms.length > 1 ? 0.5 : 0) + index / 100_000;
      if (rule.foreground && (!foreground || weight >= foreground.weight)) foreground = { weight, value: rule.foreground };
      if (rule.fontStyle && (!fontStyle || weight >= fontStyle.weight)) fontStyle = { weight, value: rule.fontStyle };
    }
  });
  return { foreground: foreground?.value, fontStyle: fontStyle?.value };
}

/** The first candidate scope the theme colours; a font style alone is kept when no candidate has a colour. */
function resolveRole(rules: readonly VsCodeTokenRule[], role: string): Resolved {
  let styleOnly: Resolved | undefined;
  for (const scope of ROLE_SCOPES[role] ?? []) {
    const found = resolveScope(rules, scope);
    if (found.foreground) return found;
    styleOnly ??= found.fontStyle ? { fontStyle: found.fontStyle } : undefined;
  }
  return styleOnly ?? {};
}

export function mapSyntax(theme: VsCodeTheme, surface: Rgba, text: Rgba): MappedTheme["syntax"] {
  const rules = theme.tokenColors;
  const defaultRule = rules.find((rule) => rule.scope.length === 0 && rule.foreground);
  const base = parseColor(defaultRule?.foreground) ?? parseColor(theme.colors["editor.foreground"]) ?? text;
  const fit = (color: Rgba, minimum: number) => ensureContrast(flatten(color, surface), surface, minimum);
  const baseText = fit(base, CONTRAST.primary);
  const syntax: Record<string, SyntaxStyle> = {};
  for (const [key, role] of Object.entries(KEY_ROLES)) {
    const found = resolveRole(rules, role);
    const dim = role === "comment" || role === "docComment" || role === "quote";
    const color = found.foreground ? fit(parseColor(found.foreground) ?? base, dim ? CONTRAST.comment : CONTRAST.syntax) : baseText;
    const style: SyntaxStyle = { color: formatColor(color) };
    const words = (found.fontStyle ?? "").split(/\s+/);
    if (words.includes("italic")) style.font_style = "italic";
    if (words.includes("bold")) style.font_weight = 700;
    syntax[key] = style;
  }
  return { background: formatColor(surface), text: formatColor(baseText), syntax };
}

// ---------------------------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------------------------

const ANSI_KEYS = [
  ["black", "terminal.ansiBlack"], ["red", "terminal.ansiRed"], ["green", "terminal.ansiGreen"], ["yellow", "terminal.ansiYellow"],
  ["blue", "terminal.ansiBlue"], ["magenta", "terminal.ansiMagenta"], ["cyan", "terminal.ansiCyan"], ["white", "terminal.ansiWhite"],
  ["brightBlack", "terminal.ansiBrightBlack"], ["brightRed", "terminal.ansiBrightRed"], ["brightGreen", "terminal.ansiBrightGreen"], ["brightYellow", "terminal.ansiBrightYellow"],
  ["brightBlue", "terminal.ansiBrightBlue"], ["brightMagenta", "terminal.ansiBrightMagenta"], ["brightCyan", "terminal.ansiBrightCyan"], ["brightWhite", "terminal.ansiBrightWhite"],
] as const;

function rgbaString({ r, g, b }: Rgba, alpha: number) {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Number(alpha.toFixed(2))})`;
}

export function mapTerminal(theme: VsCodeTheme, bg0: Rgba, bg1: Rgba, text: Rgba): Partial<TerminalColors> {
  const colors = theme.colors;
  const background = flatten(channel(colors, "terminal.background", "editor.background") ?? bg0, bg0);
  const backdrops = [background, bg0, bg1];
  const out: Partial<TerminalColors> = { background: css(background) };
  const foreground = flatten(channel(colors, "terminal.foreground", "foreground", "editor.foreground") ?? text, background);
  out.foreground = css(ensureContrast(foreground, backdrops, CONTRAST.primary));
  const cursor = flatten(channel(colors, "terminalCursor.foreground", "editorCursor.foreground") ?? foreground, background);
  out.cursor = css(ensureContrast(cursor, backdrops, CONTRAST.cursor));
  const selection = channel(colors, "terminal.selectionBackground", "editor.selectionBackground");
  // An opaque selection would cover the text it marks; keep it a translucent tint.
  if (selection) out.selectionBackground = rgbaString(selection, Math.min(0.4, Math.max(0.16, selection.a)));
  for (const [name, key] of ANSI_KEYS) {
    const color = channel(colors, key);
    if (color) out[name] = css(flatten(color, background));
  }
  return { ...out, ...guardAnsi(out, backdrops.map((color) => css(color)), theme.kind) };
}

/**
 * The 16 ANSI colours lifted until they read on the terminal's backgrounds. The extremes (black
 * on a dark theme, white on a light one) are meant to sit close to the background and get a lower floor.
 */
export function guardAnsi(colors: Partial<TerminalColors>, backgrounds: readonly string[], kind: Palette): Partial<TerminalColors> {
  const backdrops = backgrounds.map((value) => parseColor(value)).filter((value): value is Rgba => value !== null);
  const out: Partial<TerminalColors> = {};
  if (!backdrops.length) return out;
  for (const [name] of ANSI_KEYS) {
    const color = parseColor(colors[name]);
    if (!color) continue;
    const extreme = kind === "dark" ? name === "black" : name === "white";
    out[name] = css(ensureContrast(color, backdrops, extreme ? CONTRAST.ansiExtreme : CONTRAST.ansi));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Whole theme
// ---------------------------------------------------------------------------------------------

const cache = new WeakMap<VsCodeTheme, MappedTheme>();

export function mapVsCodeTheme(theme: VsCodeTheme): MappedTheme {
  const known = cache.get(theme);
  if (known) return known;
  const palette = mapPalette(theme);
  const { bg0, bg1 } = palette.surfaces;
  const mapped: MappedTheme = {
    id: theme.id,
    name: theme.name,
    kind: theme.kind,
    css: palette.css,
    terminal: mapTerminal(theme, bg0, bg1, palette.text),
    syntax: mapSyntax(theme, bg0, palette.text),
    swatches: {
      background: css(bg0), surface: css(bg1), text: css(palette.text), muted: palette.css["--text-muted"], accent: css(palette.accent), border: css(palette.border),
    },
  };
  cache.set(theme, mapped);
  return mapped;
}

/** The theme in use for a palette, if any: it must be installed and made for that palette. */
export function activeVsCodeTheme(settings: Pick<AppSettings, "vscodeThemes" | "lightVscodeTheme" | "darkVscodeTheme">, palette: Palette): VsCodeTheme | null {
  const id = palette === "light" ? settings.lightVscodeTheme : settings.darkVscodeTheme;
  if (!id) return null;
  return settings.vscodeThemes.find((theme) => theme.id === id && theme.kind === palette) ?? null;
}

/** Sets (or clears) the theme's custom properties on the root element. */
export function applyThemeTokens(root: HTMLElement, theme: VsCodeTheme | null) {
  for (const name of THEME_TOKEN_NAMES) root.style.removeProperty(name);
  if (!theme) { delete root.dataset.vscodeTheme; return; }
  const mapped = mapVsCodeTheme(theme);
  for (const [name, value] of Object.entries(mapped.css)) root.style.setProperty(name, value);
  root.dataset.vscodeTheme = theme.id;
}

// ---------------------------------------------------------------------------------------------
// Settings validation (the shape the back end also checks)
// ---------------------------------------------------------------------------------------------

export const MAX_INSTALLED_THEMES = 48;
const COLOR = /^#([0-9a-f]{6}|[0-9a-f]{8})$/;
const SCOPE = /^[A-Za-z0-9._+*#$@:/ -]{1,128}$/;
const FONT_STYLES = new Set(["italic", "bold", "underline", "strikethrough"]);

function normalizeTheme(value: unknown): VsCodeTheme | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !/^vsc-[0-9a-f]{16}$/.test(raw.id)) return null;
  if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 80) return null;
  if (raw.kind !== "light" && raw.kind !== "dark") return null;
  const source = typeof raw.source === "string" ? raw.source.slice(0, 200) : "";
  const colors: Record<string, string> = {};
  if (raw.colors && typeof raw.colors === "object") {
    for (const [key, color] of Object.entries(raw.colors as Record<string, unknown>)) {
      if (Object.keys(colors).length >= 80) break;
      if (typeof color === "string" && COLOR.test(color) && /^[A-Za-z.]{1,64}$/.test(key)) colors[key] = color;
    }
  }
  const tokenColors: VsCodeTokenRule[] = [];
  if (Array.isArray(raw.tokenColors)) {
    for (const rule of raw.tokenColors.slice(0, 400)) {
      if (!rule || typeof rule !== "object") continue;
      const item = rule as Record<string, unknown>;
      const scope = Array.isArray(item.scope) ? item.scope.filter((entry): entry is string => typeof entry === "string" && SCOPE.test(entry)).slice(0, 16) : [];
      const foreground = typeof item.foreground === "string" && COLOR.test(item.foreground) ? item.foreground : undefined;
      const words = typeof item.fontStyle === "string" ? item.fontStyle.split(/\s+/).filter((word) => FONT_STYLES.has(word)) : [];
      if (!foreground && !words.length) continue;
      tokenColors.push({ scope, ...(foreground ? { foreground } : {}), ...(words.length ? { fontStyle: words.join(" ") } : {}) });
    }
  }
  return { id: raw.id, name: raw.name.trim(), kind: raw.kind, source, colors, tokenColors };
}

const normalized = new WeakMap<object, VsCodeTheme[]>();
/** A loaded settings value reduced to valid, bounded themes with unique ids (remembered per input array). */
export function normalizeVsCodeThemes(value: unknown): VsCodeTheme[] {
  if (!Array.isArray(value)) return [];
  const known = normalized.get(value);
  if (known) return known;
  const seen = new Set<string>();
  const out: VsCodeTheme[] = [];
  for (const entry of value) {
    const theme = normalizeTheme(entry);
    if (!theme || seen.has(theme.id)) continue;
    seen.add(theme.id);
    out.push(theme);
    if (out.length >= MAX_INSTALLED_THEMES) break;
  }
  normalized.set(value, out);
  return out;
}

/** An active id that names an installed theme of the slot's kind, else null (Default (Sirus)). */
export function normalizeActiveTheme(value: unknown, themes: readonly VsCodeTheme[], kind: Palette): string | null {
  return typeof value === "string" && themes.some((theme) => theme.id === value && theme.kind === kind) ? value : null;
}
