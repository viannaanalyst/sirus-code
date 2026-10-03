// Simulated API for the real ChangesPane; never calls Git, a CLI or the network.
import type { SwitchyardClient } from "@/client";
import type { GitHistoryEntry, GitWorkspaceEntry, GitWorkspaceSnapshot } from "@/client/types";
import { fixtureRoot, fixtureSessionId, observePreviewCreation, previewFile } from "./workspace-tools-files";

const file = (path: string, kind: GitWorkspaceEntry["kind"]): GitWorkspaceEntry => ({ path, kind, conflicted: false, actionable: true });
const hash = (number: number) => number.toString(16).repeat(40).slice(0, 40);
const history: GitHistoryEntry[] = [
  { hash: hash(3), parents: [hash(2)], subject: "Add login page", author: "Gabriel", authoredAt: "2026-10-03T11:30:00Z", refs: ["HEAD -> main"] },
  { hash: hash(2), parents: [hash(1)], subject: "Add workspace layout", author: "Gabriel", authoredAt: "2026-10-02T16:00:00Z", refs: [] },
  { hash: hash(1), parents: [], subject: "Initial project", author: "Gabriel", authoredAt: "2026-10-01T09:00:00Z", refs: [] },
];
let revision = 0;
let sequence = 3;
function initial(): GitWorkspaceSnapshot {
  return {
    identity: { isRepo: true, root: fixtureRoot, branch: "main", detached: false },
    head: hash(3), indexToken: `preview-${revision}`, staged: [file("src/components/Login.tsx", "modified")],
    unstaged: [file("src/components/Login.tsx", "modified"), file("README.md", "modified"), file("docs/notes.md", "untracked")],
    truncated: false, conflicts: false, outsideScope: false, ahead: 1, behind: 0,
    history: structuredClone(history), historyTruncated: false,
  };
}
let snapshot = initial();
function changed() { snapshot.indexToken = `preview-${++revision}`; }
function owned(sessionId: string) {
  if (sessionId !== fixtureSessionId) throw new Error("Sessão fora desta prévia.");
}
function current(token: string) {
  if (token !== snapshot.indexToken) throw new Error("A preparação mudou. Atualize e tente novamente.");
}
export function resetPreviewGit() { revision++; sequence = 3; snapshot = initial(); }
observePreviewCreation(path => {
  snapshot.unstaged.push(file(path, "untracked"));
  changed();
});
let titleJob: { sessionId: string; requestId: string; cancel: () => void } | null = null;
let titleSequence = 0;
export const previewGit: Pick<SwitchyardClient, "gitWorkspace" | "gitWorkspaceDiff" | "gitCommit" | "gitPush" | "gitCommitTitle" | "cancelCommitTitle"> = {
  async gitCommitTitle(sessionId, token, requestId) {
    owned(sessionId); current(token);
    if (titleJob) throw new Error("Another commit title request is already running");
    const partial = ++titleSequence % 2 === 0;
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        titleJob = null;
        resolve({ type: "title", title: "Clarify the login button label", provider: partial ? "claude" : "codex", partial });
      }, 1800);
      titleJob = { sessionId, requestId, cancel: () => { clearTimeout(timer); titleJob = null; resolve(null); } };
    });
  },
  async cancelCommitTitle(sessionId, requestId) {
    owned(sessionId);
    if (titleJob?.sessionId === sessionId && titleJob.requestId === requestId) titleJob.cancel();
  },
  async gitWorkspace(action) {
    owned(action.sessionId);
    if (action.type !== "snapshot") {
      current(action.expectedIndex);
      const source = action.type === "stage" ? snapshot.unstaged : snapshot.staged;
      const entries = action.paths.map(path => {
        const entry = source.find(candidate => candidate.path === path);
        if (!entry) throw new Error("O arquivo mudou. Atualize o exemplo.");
        return entry;
      });
      for (const entry of entries) {
        if (action.type === "stage") {
          snapshot.staged = snapshot.staged.filter(candidate => candidate.path !== entry.path);
          snapshot.staged.push({ ...entry, kind: entry.kind === "untracked" ? "added" : entry.kind });
          snapshot.unstaged = snapshot.unstaged.filter(candidate => candidate.path !== entry.path);
        } else {
          snapshot.staged = snapshot.staged.filter(candidate => candidate.path !== entry.path);
          if (!snapshot.unstaged.some(candidate => candidate.path === entry.path)) snapshot.unstaged.push({ ...entry, kind: entry.kind === "added" ? "untracked" : entry.kind });
        }
      }
      changed();
    }
    return structuredClone(snapshot);
  },
  async gitWorkspaceDiff(sessionId, path, staged, token) {
    owned(sessionId); current(token);
    const entry = (staged ? snapshot.staged : snapshot.unstaged).find(candidate => candidate.path === path);
    if (!entry) throw new Error("Selecione um arquivo existente no exemplo.");
    if (entry.kind === "untracked") return `+++ untracked\n${previewFile(`${fixtureRoot}/${path}`) ?? ""}`;
    if (entry.kind === "added") return `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+${previewFile(`${fixtureRoot}/${path}`)?.trim() || ""}\n`;
    if (path !== "src/components/Login.tsx") return `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-# Projeto\n+# Projeto de exemplo\n`;
    return `--- a/${path}\n+++ b/${path}\n@@ -1,3 +1,3 @@\n export function Login() {\n-  return <button>Login</button>;\n+  return <button>${staged ? "Entrar" : "Continuar"}</button>;\n }\n`;
  },
  async gitCommit(sessionId, message, token) {
    owned(sessionId);
    if (token !== undefined) current(token);
    if (!message.trim() || !snapshot.staged.length) throw new Error("Prepare um arquivo e escreva o título.");
    const commit: GitHistoryEntry = { hash: hash(++sequence), parents: snapshot.head ? [snapshot.head] : [], subject: message.trim().split("\n")[0], author: "Você · exemplo", authoredAt: new Date().toISOString(), refs: ["HEAD -> main"] };
    snapshot.history = [commit, ...snapshot.history.map(entry => ({ ...entry, refs: [] }))];
    snapshot.head = commit.hash;
    snapshot.staged = [];
    snapshot.ahead = (snapshot.ahead ?? 0) + 1;
    changed();
    return { hash: commit.hash, summary: commit.subject };
  },
  async gitPush(sessionId) { owned(sessionId); snapshot.ahead = 0; return { branch: "main" }; },
};
