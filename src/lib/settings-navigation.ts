import type { SettingsSectionId } from "@/lib/settings";

/** Menu order of the Settings sidebar; content enters from the direction of travel. */
export const SETTINGS_SECTION_ORDER: readonly SettingsSectionId[] = ["general", "chat", "appearance", "notifications", "keybindings", "providers", "skills", "computer", "git", "worktrees", "terminal", "advanced"];

/** Arbitrate at the dialog's capture boundary before a shortcut recorder bubbles. */
export function settingsEscapeAction(recording: boolean) {
  return recording ? "recording" : "close";
}

/** 1 when moving down the menu, -1 when moving up. */
export function settingsViewDirection(from: SettingsSectionId, to: SettingsSectionId): 1 | -1 {
  return SETTINGS_SECTION_ORDER.indexOf(to) >= SETTINGS_SECTION_ORDER.indexOf(from) ? 1 : -1;
}
