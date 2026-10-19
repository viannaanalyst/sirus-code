import type { ProjectFolder } from "@/client/types";

/**
 * One row of a project's context menu, the same menu wherever a project shows (the header
 * switcher, the conversation list's folders, the Project style's title and strip; ADR-139).
 */
export type ProjectMenuEntry =
  | { kind: "new" | "edit" | "new-folder" | "reveal" | "copy-path" | "remove" }
  | { kind: "move" | "out"; folder: ProjectFolder };

/** Rows sharing a group sit together; a rule separates the groups. */
export const PROJECT_MENU_GROUP: Record<ProjectMenuEntry["kind"], string> = {
  new: "new", edit: "edit", move: "folders", out: "folders", "new-folder": "folders", reveal: "path", "copy-path": "path", remove: "danger",
};

/**
 * New conversation; Edit project; Move to each other folder, out of its own, or a new folder
 * with it; Open in Finder and Copy path; Remove from list last.
 */
export function projectMenuEntries(projectId: string, folders: readonly ProjectFolder[]): ProjectMenuEntry[] {
  const current = folders.find(folder => folder.projectIds.includes(projectId));
  return [
    { kind: "new" },
    { kind: "edit" },
    ...folders.filter(folder => folder !== current).map(folder => ({ kind: "move" as const, folder })),
    ...(current ? [{ kind: "out" as const, folder: current }] : []),
    { kind: "new-folder" },
    { kind: "reveal" },
    { kind: "copy-path" },
    { kind: "remove" },
  ];
}
