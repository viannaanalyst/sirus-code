import { Folder as FolderGlyph, FolderOpen as FolderOpenGlyph } from "@phosphor-icons/react";
import type { Project, ProjectLook } from "@/client/types";
import { useEffect, useState } from "react";
import { client } from "@/client";
import { AstroIcon } from "@/components/astros/AstroArt";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/cn";

/** Preset folder colours (ADR-059); custom colours are stored as `#rrggbb`. */
export const PROJECT_COLORS: Record<string, string> = {
  blue: "#4f8cff", red: "#e5604d", yellow: "#f0c43a", green: "#4cc06c", pink: "#e0609a",
  purple: "#a16ae8", teal: "#45b8ac", orange: "#ee8a3a", gray: "#8e8e93",
};

/** Astro icons have no neutral folder tint; without a colour they use the Astro default. */
const ASTRO_DEFAULT = "#8c9bff";

export const projectColor = (look?: ProjectLook) => look?.color ? PROJECT_COLORS[look.color] ?? look.color : undefined;

// One native lookup per project while the app runs (cleared when the setting changes).
const autoIcons = new Map<string, Promise<string | null>>();
let autoIconsEnabled = false;
function useAutoIcon(projectId: string | undefined, wanted: boolean): string | null {
  const enabled = useAppStore((state) => state.settings.projectAutoIcons);
  const [icon, setIcon] = useState<{ id: string; url: string | null } | null>(null);
  if (enabled !== autoIconsEnabled) { autoIconsEnabled = enabled; autoIcons.clear(); }
  const active = Boolean(enabled && wanted && projectId);
  useEffect(() => {
    if (!active || !projectId) return;
    let alive = true;
    let lookup = autoIcons.get(projectId);
    if (!lookup) { lookup = client.projectAutoIcon(projectId).catch(() => null); autoIcons.set(projectId, lookup); }
    void lookup.then((url) => { if (alive) setIcon({ id: projectId, url }); });
    return () => { alive = false; };
  }, [active, projectId]);
  return active && icon && icon.id === projectId ? icon.url : null;
}

/** A project's sidebar icon: its logo, emoji or Astro icon, else (optionally) its own favicon, else the folder in its colour. */
export function ProjectGlyph({ project, expanded = false, size = 15, className }: { project: Pick<Project, "look"> & { id?: string }; expanded?: boolean; size?: number; className?: string }) {
  const look = project.look;
  const auto = useAutoIcon(project.id, !look?.logo && !look?.emoji && !look?.astro);
  if (look?.logo) return <img src={look.logo} alt="" draggable={false} aria-hidden="true" className={cn("project-glyph-logo", className)} style={{ width: size, height: size }} />;
  if (look?.emoji) return <span aria-hidden="true" className={cn("project-glyph-emoji", className)} style={{ width: size, height: size, fontSize: Math.round(size * 0.9) }}>{look.emoji}</span>;
  if (look?.astro) {
    // The drawings leave a margin inside their square; draw larger and let it overhang so it reads like the folder.
    const drawn = Math.round(size * 1.7), overhang = Math.round((drawn - size) / 2);
    return <span aria-hidden="true" className={cn("project-glyph-astro", className)} style={{ position: "relative", display: "inline-block", width: size, height: size, flexShrink: 0, marginRight: overhang, verticalAlign: "middle" }}>
      {/* A block wrapper with no line box, so centring uses the canvas itself, level with the title. */}
      <span style={{ position: "absolute", left: "50%", top: "50%", display: "block", lineHeight: 0, transform: "translate(-50%, -50%)", pointerEvents: "none" }}>
        <AstroIcon icon={look.astro.icon} style={look.astro.style} color={projectColor(look) ?? ASTRO_DEFAULT} size={drawn} still />
      </span>
    </span>;
  }
  if (auto) return <img src={auto} alt="" draggable={false} aria-hidden="true" className={cn("project-glyph-logo", className)} style={{ width: size, height: size }} />;
  const Glyph = expanded ? FolderOpenGlyph : FolderGlyph;
  const color = projectColor(look);
  return <Glyph aria-hidden="true" size={size} weight={color ? "duotone" : "regular"} className={cn("sidebar-folder-glyph", className)} style={color ? { color } : undefined} />;
}
