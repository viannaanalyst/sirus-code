import { House } from "@/components/icons";

/** The rail's Home glyph (Solar); the active page uses the Bold weight. */
export function SidebarNavigationIcon({ filled = false, size = 15 }: { filled?: boolean; size?: number }) {
  return <House size={size} weight={filled ? "fill" : "regular"} aria-hidden="true" focusable="false" />;
}
