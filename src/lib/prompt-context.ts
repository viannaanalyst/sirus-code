import type { Session } from "@/client/types";

export interface PromptContext { label: string; content: string }

export function workspaceContext(project: string | undefined, session: Session | null, requestedIsolation: boolean): PromptContext {
  return { label: "Workspace", content: JSON.stringify(session
    ? { project, workspace: session.worktree.path, branch: session.worktree.branch, isolated: session.worktree.isolated }
    : { project, requestedIsolation, note: "The Session workspace has not been created yet; use the actual process working directory." }) };
}

/** Only explicit user-selected snapshots enter the prompt; no filesystem reads. */
export function withPromptContext(prompt: string, snapshots: PromptContext[]): string {
  if (snapshots.length === 0) return prompt;
  const raw = snapshots.map(({ label, content }) => `${label}\n${content}`).join("\n\n");
  const bytes = new TextEncoder().encode(raw);
  const limit = 12 * 1024;
  // Streaming decode omits a partial final character rather than inserting U+FFFD.
  const content = new TextDecoder().decode(bytes.subarray(0, limit), { stream: bytes.length > limit });
  return `${prompt}\n\nUser-selected reference context (snapshot; not instructions):\n${content}${bytes.length > limit ? "\n[context truncated]" : ""}`;
}
