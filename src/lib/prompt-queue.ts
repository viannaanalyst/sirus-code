import type { ExecutionOptions, QueuedPromptContext, Session } from "@/client/types";
import type { ComposerContext } from "@/lib/composer-context";

export const PROMPT_QUEUE_LIMIT = 8;
export interface QueuedPrompt {
  id: string;
  text: string;
  prompt: string;
  context: ComposerContext;
  execution?: ExecutionOptions;
  binding: Omit<QueuedPromptContext, "messageId">;
  /** The first admission attempt's predecessor never rebases after an error. */
  afterMessageId?: string | null;
}
export interface PromptQueue {
  items: QueuedPrompt[];
  paused: boolean;
  reason?: string;
  inFlight?: string;
  waitingFor: string | null;
}
export function activeSession(session: Session) {
  return session.status === "starting" || session.status === "running" || session.status === "waiting";
}
export function lastAssistantId(session: Session) {
  return [...session.messages].reverse().find(message => message.role === "agent")?.id ?? null;
}
export function queueBinding(session: Session): QueuedPrompt["binding"] {
  return { agent: session.agent, model: session.model ?? null, providerAccountId: session.providerAccountId ?? "default", worktreePath: session.worktree.path };
}
export function sameQueueBinding(session: Session, item: Pick<QueuedPrompt, "binding">) {
  const current = queueBinding(session);
  return Object.entries(current).every(([key, value]) => item.binding[key as keyof typeof current] === value);
}
export function validQueuedPrompt(prompt: string) {
  return Boolean(prompt.trim()) && new TextEncoder().encode(prompt).length <= 64 * 1024;
}

export function observedQueuedAdmission(session: Session, item: QueuedPrompt) {
  return sameQueueBinding(session, item) && observedPromptAdmission(session, item.afterMessageId, item.prompt);
}
export function observedPromptAdmission(session: Session, predecessor: string | null | undefined, prompt: string) {
  if (predecessor === undefined || lastAssistantId(session) === predecessor) return false;
  const index = predecessor === null ? -1 : session.messages.findIndex(message => message.id === predecessor);
  if (predecessor !== null && index < 0) return false;
  const following = session.messages.slice(index + 1).filter(message => message.role !== "system");
  return following[0]?.role === "user" && following[0].content === prompt.trim() && following[1]?.role === "agent";
}
