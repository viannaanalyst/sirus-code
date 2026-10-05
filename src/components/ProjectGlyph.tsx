import { Folder as FolderGlyph, FolderOpen as FolderOpenGlyph } from "@phosphor-icons/react";
import type { Project, ProjectLook } from "@/client/types";
import { cn } from "@/lib/cn";

/** Preset folder colours (ADR-059); custom colours are stored as `#rrggbb`. */
export const PROJECT_COLORS: Record<string, string> = {
  blue: "#4f8cff", red: "#e5604d", yellow: "#f0c43a", green: "#4cc06c", pink: "#e0609a",
  purple: "#a16ae8", teal: "#45b8ac", orange: "#ee8a3a", gray: "#8e8e93",
};

export const projectColor = (look?: ProjectLook) => look?.color ? PROJECT_COLORS[look.color] ?? look.color : undefined;

/** A project's sidebar icon: its logo, else its emoji, else the folder in its colour. */
export function ProjectGlyph({ project, expanded = false, size = 15, className }: { project: Pick<Project, "look">; expanded?: boolean; size?: number; className?: string }) {
  const look = project.look;
  if (look?.logo) return <img src={look.logo} alt="" draggable={false} aria-hidden="true" className={cn("project-glyph-logo", className)} style={{ width: size, height: size }} />;
  if (look?.emoji) return <span aria-hidden="true" className={cn("project-glyph-emoji", className)} style={{ width: size, height: size, fontSize: Math.round(size * 0.9) }}>{look.emoji}</span>;
  const Glyph = expanded ? FolderOpenGlyph : FolderGlyph;
  const color = projectColor(look);
  return <Glyph aria-hidden="true" size={size} weight={color ? "duotone" : "regular"} className={cn("sidebar-folder-glyph", className)} style={color ? { color } : undefined} />;
}
