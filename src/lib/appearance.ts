import type { AppSettings, AppearanceSupport, Session } from "@/client/types";
import { hasConversation } from "./transcripts";

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
/** xterm accepts concrete colors rather than CSS color-mix()/color() values. */
export function terminalAppearance(settings: AppSettings, support?: AppearanceSupport, systemPalette: "dark" | "light" = "dark") {
  const material = resolveAppearanceMaterial(settings, support, systemPalette);
  const light = material.palette === "light";
  const glass = material.windowGlass;
  return { background: glass ? "#00000000" : light ? "#f4f4f5" : "#0c0c0c", foreground: light ? "#18181b" : "#ececec", cursor: light ? "#18181b" : "#ececec" };
}
