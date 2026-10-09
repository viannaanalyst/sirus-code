import type { AppSettings, ProjectFolder, ProjectLook } from "@/client/types";

/** Switcher folders (2026-10-09): pure edits of `settings.projectFolders`. Display only. */

export function createFolder(settings: AppSettings, id: string, name: string): AppSettings {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return settings;
  return { ...settings, projectFolders: [...settings.projectFolders, { id, name: trimmed, look: {}, projectIds: [], collapsed: false }] };
}

export function updateFolder(settings: AppSettings, id: string, change: Partial<Pick<ProjectFolder, "name" | "look" | "collapsed">>): AppSettings {
  return { ...settings, projectFolders: settings.projectFolders.map((folder) => folder.id === id ? { ...folder, ...change, name: (change.name ?? folder.name).trim().slice(0, 80) || folder.name } : folder) };
}

/** Deleting a folder keeps its projects; they return to the loose list. */
export function deleteFolder(settings: AppSettings, id: string): AppSettings {
  return { ...settings, projectFolders: settings.projectFolders.filter((folder) => folder.id !== id) };
}

/** Moves a project into a folder (at its end), or out of every folder with `null`. */
export function moveProjectToFolder(settings: AppSettings, projectId: string, folderId: string | null): AppSettings {
  return { ...settings, projectFolders: settings.projectFolders.map((folder) => {
    const without = folder.projectIds.filter((id) => id !== projectId);
    return { ...folder, projectIds: folder.id === folderId ? [...without, projectId] : without };
  }) };
}

export function folderOf(settings: AppSettings, projectId: string): ProjectFolder | undefined {
  return settings.projectFolders.find((folder) => folder.projectIds.includes(projectId));
}

/** One icon at a time, as for projects: an emoji, line icon, Astro or image replaces the others. */
export type LookChange =
  | { kind: "color"; color: string | null }
  | { kind: "emoji"; emoji: string | null }
  | { kind: "icon"; icon: string | null }
  | { kind: "astro"; astro: ProjectLook["astro"] }
  | { kind: "logo"; logo: string | null }
  | { kind: "clear" };

export function applyLookChange(look: ProjectLook, change: LookChange): ProjectLook {
  const bare = { color: look.color ?? null };
  switch (change.kind) {
    case "color": return { ...look, color: change.color };
    case "emoji": return change.emoji ? { ...bare, emoji: change.emoji } : { ...look, emoji: null };
    case "icon": return change.icon ? { ...bare, icon: change.icon } : { ...look, icon: null };
    case "astro": return change.astro ? { ...bare, astro: change.astro } : { ...look, astro: null };
    case "logo": return change.logo ? { ...bare, logo: change.logo } : { ...look, logo: null };
    case "clear": return bare;
  }
}

/** Rows of the switcher list: each folder followed by its projects (unless collapsed), then loose projects. */
export type SwitcherEntry<P> = { kind: "folder"; folder: ProjectFolder; count: number; open: boolean } | { kind: "project"; project: P; folderId: string | null };

export function switcherEntries<P extends { id: string }>(projects: P[], folders: ProjectFolder[], searching: boolean): SwitcherEntry<P>[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const placed = new Set<string>();
  const entries: SwitcherEntry<P>[] = [];
  for (const folder of folders) {
    // Keep the switcher's project order inside the folder.
    const members = projects.filter((project) => folder.projectIds.includes(project.id) && !placed.has(project.id));
    members.forEach((project) => placed.add(project.id));
    // While searching, folders show only when something inside matches, and open.
    if (searching && !members.length) continue;
    const open = searching || !folder.collapsed;
    entries.push({ kind: "folder", folder, count: members.length, open });
    if (open) for (const project of members) entries.push({ kind: "project", project, folderId: folder.id });
  }
  for (const project of projects) if (!placed.has(project.id) && byId.has(project.id)) entries.push({ kind: "project", project, folderId: null });
  return entries;
}
