import { Archive, House, Kanban } from "@phosphor-icons/react";

/** Rail navigation glyphs (Phosphor); the active section uses the filled weight. */
export function SidebarNavigationIcon({ section, filled = false, size = 15 }: { section: "home" | "kanban" | "archived"; filled?: boolean; size?: number }) {
  const Glyph = section === "home" ? House : section === "kanban" ? Kanban : Archive;
  return <Glyph size={size} weight={filled ? "fill" : "regular"} aria-hidden="true" focusable="false" />;
}
