/** A turn's changed files as a folder tree (after T3 Code): single-child folders merge ("src/components"), folders first, natural order. */
export interface DiffStat { additions: number; deletions: number }
export type DiffTreeNode =
  | { kind: "directory"; name: string; path: string; stat: DiffStat; children: DiffTreeNode[] }
  | { kind: "file"; name: string; path: string; stat: DiffStat | null };

interface Folder { name: string; path: string; stat: DiffStat; folders: Map<string, Folder>; files: DiffTreeNode[] }
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function buildDiffTree(files: readonly { path: string; additions?: number; deletions?: number; binary?: boolean }[]): DiffTreeNode[] {
  const root: Folder = { name: "", path: "", stat: { additions: 0, deletions: 0 }, folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.replaceAll("\\", "/").split("/").filter(Boolean);
    const name = parts.pop() ?? file.path;
    const stat = file.binary || typeof file.additions !== "number" || typeof file.deletions !== "number" ? null : { additions: file.additions, deletions: file.deletions };
    let folder = root;
    for (const part of parts) {
      const path = folder.path ? `${folder.path}/${part}` : part;
      let next = folder.folders.get(part);
      if (!next) { next = { name: part, path, stat: { additions: 0, deletions: 0 }, folders: new Map(), files: [] }; folder.folders.set(part, next); }
      if (stat) { next.stat.additions += stat.additions; next.stat.deletions += stat.deletions; }
      folder = next;
    }
    folder.files.push({ kind: "file", name, path: file.path, stat });
  }
  const nodes = (folder: Folder): DiffTreeNode[] => [
    ...[...folder.folders.values()].sort((a, b) => collator.compare(a.name, b.name)).map((child): DiffTreeNode => {
      let node: DiffTreeNode = { kind: "directory", name: child.name, path: child.path, stat: child.stat, children: nodes(child) };
      // A folder holding only one folder reads as one row.
      while (node.kind === "directory" && node.children.length === 1 && node.children[0].kind === "directory") {
        const only: Extract<DiffTreeNode, { kind: "directory" }> = node.children[0];
        node = { kind: "directory", name: `${node.name}/${only.name}`, path: only.path, stat: only.stat, children: only.children };
      }
      return node;
    }),
    ...[...folder.files].sort((a, b) => collator.compare(a.name, b.name)),
  ];
  return nodes(root);
}

export function diffTotals(files: readonly { additions: number; deletions: number; binary?: boolean }[]): DiffStat {
  return files.reduce((sum, file) => file.binary ? sum : { additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }, { additions: 0, deletions: 0 });
}
