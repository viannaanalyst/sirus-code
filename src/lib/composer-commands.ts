import type { AgentProviderId, Message, Session } from "@/client/types";

/** App commands offered at a leading `/` (they act on the app and are never sent as text). */
export type ComposerCommandId = "review" | "compact" | "status" | "fast" | "rename" | "fork" | "export" | "side" | "new";

export interface ComposerCommand { id: ComposerCommandId; description: string }

const COMMANDS: ComposerCommand[] = [
  { id: "review", description: "commands.review" },
  { id: "compact", description: "commands.compact" },
  { id: "status", description: "commands.status" },
  { id: "fast", description: "commands.fast" },
  { id: "rename", description: "commands.rename" },
  { id: "fork", description: "commands.fork" },
  { id: "export", description: "commands.export" },
  { id: "side", description: "commands.side" },
  { id: "new", description: "commands.new" },
];

export interface CommandContext {
  session: Pick<Session, "status" | "sideChat" | "messages"> | null;
  agent: AgentProviderId;
  fastAvailable: boolean;
}

/** Commands that make sense in this composer: most need a started conversation. */
export function availableCommands(context: CommandContext): ComposerCommand[] {
  const { session } = context;
  const idle = session ? !["starting", "running", "waiting"].includes(session.status) : true;
  const settledReply = session?.messages.some((message) => message.role === "agent" && !message.streaming) ?? false;
  return COMMANDS.filter(({ id }) => {
    switch (id) {
      case "review": return true;
      case "fast": return context.fastAvailable;
      case "compact": return Boolean(session) && (context.agent === "codex" || context.agent === "claude");
      case "status": case "rename": case "export": return Boolean(session);
      case "fork": return Boolean(session && !session.sideChat && idle && settledReply);
      case "side": return Boolean(session && !session.sideChat);
      case "new": return Boolean(session && !session.sideChat);
    }
  });
}

/** Prefix matches first, then names containing the query. */
export function filterCommands(commands: ComposerCommand[], query: string): ComposerCommand[] {
  const needle = query.toLowerCase();
  return [...commands.filter(({ id }) => id.startsWith(needle)), ...commands.filter(({ id }) => !id.startsWith(needle) && id.includes(needle))];
}

/** Commands act on the whole message, so they are offered only for a leading `/`. */
export function commandPosition(value: string, start: number): boolean {
  return value.slice(0, start).trim() === "";
}

/** The `/review` turn: read-only where the provider supports planning. */
export const REVIEW_PROMPT = [
  "Review the uncommitted changes in this workspace (`git status` and `git diff`, including untracked files).",
  "List real problems from most to least severe, each with file:line, why it matters and the fix.",
  "Do not change any files. If nothing needs fixing, say so.",
].join("\n");

/** A Markdown copy of the conversation for `/export`. */
export function conversationMarkdown(session: Pick<Session, "title" | "agent" | "model" | "createdAt">, messages: Message[], labels: { you: string; agent: string }): string {
  const lines = [`# ${session.title}`, "", `${session.agent}${session.model ? ` · ${session.model}` : ""} · ${session.createdAt.slice(0, 10)}`];
  for (const message of messages) {
    if (message.role === "system" || !message.content.trim()) continue;
    lines.push("", `## ${message.role === "user" ? labels.you : labels.agent}`, "", message.content.trim());
  }
  return `${lines.join("\n")}\n`;
}
