// In-memory preview only: no paths are resolved on disk and no native calls run.
import { client } from "@/client";
import type { FileEntry, Session } from "@/client/types";
import { useAppStore } from "@/store/app-store";

export const fixtureRoot = "/preview/switchyard";
export const fixtureSessionId = "workspace-preview";
const stamp = "2026-10-03T12:00:00Z";
const initialFiles: Record<string, string | null> = {
  "src": null,
  "src/components": null,
  "src/components/Login.tsx": "export function Login() {\n  return <button>Continuar</button>;\n}\n",
  "src/styles": null,
  "src/styles/login.css": ".login { display: grid; gap: 12px; }\n",
  "docs": null,
  "docs/notes.md": "# Notas\n\nOrganizar o fluxo de login.\n",
  "README.md": "# Projeto de exemplo\n\nEsta prévia usa somente dados simulados.\n",
};
let files = { ...initialFiles };
let onCreated: (path: string) => void = () => undefined;
export function observePreviewCreation(callback: (path: string) => void) { onCreated = callback; }
export function previewFile(path: string): string | null | undefined {
  return files[path.replace(`${fixtureRoot}/`, "")];
}
export function resetPreviewFiles() { files = { ...initialFiles }; }
function relative(path: string) {
  if (path === fixtureRoot) return "";
  if (!path.startsWith(`${fixtureRoot}/`)) throw new Error("Destino fora do projeto de exemplo.");
  return path.slice(fixtureRoot.length + 1);
}
function entry(path: string): FileEntry {
  return { name: path.split("/").at(-1)!, path: `${fixtureRoot}/${path}`, isDir: files[path] === null };
}
client.listDir = async (_session, path = fixtureRoot) => {
  const prefix = relative(path);
  return Object.keys(files).filter(candidate => {
    const parent = candidate.includes("/") ? candidate.slice(0, candidate.lastIndexOf("/")) : "";
    return parent === prefix;
  }).sort((a, b) => Number(files[b] === null) - Number(files[a] === null) || a.localeCompare(b)).map(entry);
};
client.createWorkspaceEntry = async (_session, kind, name, parent = fixtureRoot) => {
  const reserved = [".git", "node_modules", "target", "dist", "build", ".next", ".turbo", ".cache", "coverage", "__pycache__", ".venv", "venv"];
  if (!name.trim() || new TextEncoder().encode(name).length > 255 || name === "." || name === ".." || reserved.includes(name.toLowerCase()) || /[/\\\u0000-\u001f\u007f-\u009f]/u.test(name)) throw new Error("Use um nome simples, sem separadores ou nomes reservados.");
  const directory = relative(parent);
  if (directory && files[directory] !== null) throw new Error("A pasta selecionada não existe.");
  const path = directory ? `${directory}/${name}` : name;
  if (Object.hasOwn(files, path)) throw new Error("Já existe um arquivo ou uma pasta com esse nome.");
  files[path] = kind === "directory" ? null : "";
  if (kind === "file") onCreated(path);
  return entry(path);
};
const session: Session = {
  id: fixtureSessionId, projectId: "preview-project", title: "Workspace de exemplo", agent: "codex", model: null,
  status: "idle", worktree: { path: fixtureRoot, branch: "main", isolated: false },
  createdAt: stamp, lastActivityAt: stamp, lastError: null, messages: [],
};
useAppStore.setState(state => ({
  projects: [{ id: "preview-project", name: "switchyard", path: fixtureRoot, addedAt: stamp, lastOpenedAt: stamp }],
  sessions: [session], selectedProjectId: "preview-project", selectedSessionId: fixtureSessionId,
  mainView: "session", settings: { ...state.settings, locale: "pt-BR", animations: false, reduceMotion: true },
  refreshGitStatus: async () => undefined,
}));
