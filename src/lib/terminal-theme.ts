import type { GhosttyColor, GhosttyTheme } from "@/terminal/ghostty/core";
import type { GhosttyCursorStyle } from "@/terminal/ghostty/renderer";
import type { AppSettings, MonoFontId } from "@/client/types";
import { MONO_FONTS } from "@/lib/fonts";

/** What `terminalAppearance` returns: the Sirus ANSI palette and base colors as CSS hex strings. */
export interface TerminalAppearance {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string; red: string; green: string; yellow: string; blue: string; magenta: string; cyan: string; white: string;
  brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string; brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string;
}

const PALETTE_ORDER = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;

/** `#rgb`, `#rrggbb` or `#rrggbbaa` as an opaque color (the alpha is dropped); null otherwise. */
export function parseHexColor(value: string): GhosttyColor | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join("") : match[1];
  return { r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16) };
}

/**
 * Maps the app's terminal appearance to Ghostty's theme. `surface` is the dock material
 * the terminal sits on (`terminalSurface`): a translucent one leaves default-background
 * cells unpainted, so window glass shows through, while reverse video keeps the opaque
 * theme color (ADR-102).
 */
export function ghosttyTheme(appearance: TerminalAppearance, surface?: { background: string; transparent: boolean }): GhosttyTheme {
  const background = parseHexColor(surface?.background ?? appearance.background) ?? parseHexColor(appearance.background) ?? { r: 12, g: 12, b: 12 };
  const transparent = surface ? surface.transparent : appearance.background.length === 9 && !appearance.background.endsWith("ff");
  const fallback = { r: 212, g: 212, b: 212 };
  return {
    foreground: parseHexColor(appearance.foreground) ?? fallback,
    background,
    cursor: parseHexColor(appearance.cursor) ?? fallback,
    palette: PALETTE_ORDER.map((name) => parseHexColor(appearance[name]) ?? fallback),
    selectionBackground: appearance.selectionBackground,
    transparentBackground: transparent,
  };
}

/** The user's cursor shape as Ghostty's style code (0 bar, 1 block, 2 underline). */
export function ghosttyCursorStyle(style: AppSettings["terminalCursorStyle"] | string): GhosttyCursorStyle {
  return style === "bar" ? 0 : style === "underline" ? 2 : 1;
}

/**
 * The family list for the canvas. The terminal draws with a canvas font string, which rejects
 * keywords such as `ui-monospace`, so only the chosen family is named; the surface adds its own
 * platform monospace and Nerd Font fallbacks after it.
 */
export function terminalFontFamily(id: MonoFontId): string {
  return (MONO_FONTS.find((font) => font.id === id) ?? MONO_FONTS[0]).family;
}

/** Command-key chords belong to the app, except the ones a terminal owns (copy, paste, select all). */
export function terminalOwnsKey(event: Pick<KeyboardEvent, "metaKey" | "key">): boolean {
  return !event.metaKey || ["c", "v", "a"].includes(event.key.toLowerCase());
}
