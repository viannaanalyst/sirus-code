import type { ProjectLook } from "@/client/types";
import { Folder as FolderGlyph, FolderOpen as FolderOpenGlyph } from "@phosphor-icons/react";
import { AstroIcon } from "@/components/AstroIcon";
import { ASTRO_DEFAULT_COLOR } from "@/lib/astro-art";
import { cn } from "@/lib/cn";
import { PROJECT_ICONS } from "@/lib/project-icons";

/** Preset folder colours (ADR-059); custom colours are stored as `#rrggbb`. */
export const PROJECT_COLORS: Record<string, string> = {
  blue: "#4f8cff", red: "#e5604d", yellow: "#f0c43a", green: "#4cc06c", pink: "#e0609a",
  purple: "#a16ae8", teal: "#45b8ac", orange: "#ee8a3a", gray: "#8e8e93",
};


export const projectColor = (look?: ProjectLook) => look?.color ? PROJECT_COLORS[look.color] ?? look.color : undefined;

/** A project folder's icon (a group in the switcher): its line icon, logo, emoji or Astro icon, else the folder in its colour. Projects themselves show their avatar (`ProjectIcon`, ADR-175). */
export function ProjectGlyph({ project, expanded = false, size = 15, className }: { project: { look?: ProjectLook }; expanded?: boolean; size?: number; className?: string }) {
  const look = project.look;
  const LineIcon = look?.icon ? PROJECT_ICONS[look.icon]?.Icon : undefined;
  if (LineIcon) return <LineIcon aria-hidden="true" size={size} weight="regular" className={cn("sidebar-folder-glyph", className)} style={{ color: projectColor(look) ?? "var(--text-secondary)" }} />;
  if (look?.logo) return <img src={look.logo} alt="" draggable={false} aria-hidden="true" className={cn("project-glyph-logo", className)} style={{ width: size, height: size }} />;
  if (look?.emoji) return <span aria-hidden="true" className={cn("project-glyph-emoji", className)} style={{ width: size, height: size, fontSize: Math.round(size * 0.9) }}>{look.emoji}</span>;
  if (look?.astro) {
    // The drawings leave a margin inside their square; draw larger and let it overhang so it reads like the folder.
    const drawn = Math.round(size * 1.7), overhang = Math.round((drawn - size) / 2);
    return <span aria-hidden="true" className={cn("project-glyph-astro", className)} style={{ position: "relative", display: "inline-block", width: size, height: size, flexShrink: 0, marginRight: overhang, verticalAlign: "middle" }}>
      {/* A block wrapper with no line box, so centring uses the canvas itself, level with the title. */}
      <span style={{ position: "absolute", left: "50%", top: "50%", display: "block", lineHeight: 0, transform: "translate(-50%, -50%)", pointerEvents: "none" }}>
        <AstroIcon icon={look.astro.icon} style={look.astro.style} color={projectColor(look) ?? ASTRO_DEFAULT_COLOR} size={drawn} still />
      </span>
    </span>;
  }
  const Glyph = expanded ? FolderOpenGlyph : FolderGlyph;
  const color = projectColor(look);
  return <Glyph aria-hidden="true" size={size} weight={color ? "duotone" : "regular"} className={cn("sidebar-folder-glyph", className)} style={color ? { color } : undefined} />;
}
