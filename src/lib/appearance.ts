import type { AppSettings, AppearanceSupport, Session } from "@/client/types";
import { hasConversation } from "./transcripts";
import { activeVsCodeTheme, guardAnsi, mapVsCodeTheme } from "./vscode-theme";

/** Landing and pending handoffs retain their own background until conversation starts. */
export function isConversationStarted(session: Session | null) {
  return Boolean(session && !session.handoff?.pending && hasConversation(session));
}
/** Native authority decides whether desktop materials are available. Unknown hosts stay opaque. */
export function resolveAppearanceMaterial(settings: AppSettings, support?: AppearanceSupport, systemPalette: "dark" | "light" = "dark") {
  const palette = settings.theme === "system" ? systemPalette : settings.theme;
  const windowGlass = support?.translucency === true && (palette === "light" ? settings.lightWindowTranslucent : settings.darkWindowTranslucent);
  const sidebarGlass = windowGlass || (support?.translucency === true && (palette === "light" ? settings.lightSidebarTranslucent : settings.darkSidebarTranslucent));
  return { palette, windowGlass, sidebarGlass, windowOpacity: palette === "light" ? settings.lightWindowOpacity : settings.darkWindowOpacity, sidebarOpacity: palette === "light" ? settings.lightSidebarOpacity : settings.darkSidebarOpacity };
}
/**
 * The terminal takes concrete colors rather than CSS color-mix()/color() values. On window glass
 * the background is the theme's own color at zero alpha: reverse video (selections,
 * vim/less/fzf highlights) paints with the opaque form, which must stay the theme
 * color rather than black (ADR-102). `ghosttyTheme` maps this to Ghostty (ADR-170).
 */
export function terminalAppearance(settings: AppSettings, support?: AppearanceSupport, systemPalette: "dark" | "light" = "dark") {
  const material = resolveAppearanceMaterial(settings, support, systemPalette);
  const light = material.palette === "light";
  // An imported VS Code theme (ADR-185) replaces the colours it defines, already contrast-guarded.
  const theme = activeVsCodeTheme(settings, material.palette);
  const imported = theme ? mapVsCodeTheme(theme).terminal : {};
  const base = imported.background ?? (light ? "#f4f4f5" : "#0c0c0c");
  const palette = { ...(light ? TERMINAL_ANSI_LIGHT : TERMINAL_ANSI_DARK), ...imported };
  return {
    ...palette,
    // Sirus's own ANSI colours that the theme leaves out are held to the same floor on its background.
    ...(theme ? guardAnsi(palette, [base], material.palette) : {}),
    background: material.windowGlass ? `${base}00` : base,
    foreground: imported.foreground ?? (light ? "#18181b" : "#d4d4d4"),
    cursor: imported.cursor ?? (light ? "#18181b" : "#ececec"),
    cursorAccent: base,
  };
}
/** The owner's pick "C": Sirus's own tones (green, red, violet) for ANSI colors. */
const TERMINAL_ANSI_DARK = {
  selectionBackground: "rgba(255,255,255,0.18)",
  black: "#1f1f1f", red: "#e5604d", green: "#5cc36b", yellow: "#e5b94d", blue: "#8c9bff", magenta: "#c08cff", cyan: "#5fc7c7", white: "#cfcfcf",
  brightBlack: "#6b6b6b", brightRed: "#f07a69", brightGreen: "#7bd388", brightYellow: "#f0cc72", brightBlue: "#a8b4ff", brightMagenta: "#d2abff", brightCyan: "#82d8d8", brightWhite: "#ffffff",
};
const TERMINAL_ANSI_LIGHT = {
  selectionBackground: "rgba(0,0,0,0.14)",
  black: "#27272a", red: "#c4352a", green: "#2f8a3e", yellow: "#a87a12", blue: "#4a5bd6", magenta: "#8b4fd1", cyan: "#1f8a8a", white: "#a1a1aa",
  brightBlack: "#71717a", brightRed: "#d9493c", brightGreen: "#3c9c4c", brightYellow: "#b98a1e", brightBlue: "#5d6de2", brightMagenta: "#9c63dc", brightCyan: "#2a9b9b", brightWhite: "#3f3f46",
};
/** Default-background cells are left unpainted only on window glass. */
export function terminalTransparent(settings: AppSettings, support?: AppearanceSupport, systemPalette: "dark" | "light" = "dark") {
  return resolveAppearanceMaterial(settings, support, systemPalette).windowGlass;
}
