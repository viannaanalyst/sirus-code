import { House } from "@phosphor-icons/react";

/** The rail's Home glyph (Phosphor); the active page uses the filled weight. */
export function SidebarNavigationIcon({ filled = false, size = 15 }: { filled?: boolean; size?: number }) {
  return <House size={size} weight={filled ? "fill" : "regular"} aria-hidden="true" focusable="false" />;
}
