import { useAppStore } from "@/store/app-store";
import { effectiveShortcut, shortcutLabel, type ShortcutId } from "./keybindings";

export function useShortcut(id: ShortcutId) {
  const custom = useAppStore((state) => state.settings.customShortcuts);
  return shortcutLabel(effectiveShortcut(custom, id));
}
