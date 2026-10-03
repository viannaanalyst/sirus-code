import type { AgentProviderId, ApprovalMode, PromptAttachment, Session } from "@/client/types";
import { withPromptContext } from "@/lib/prompt-context";
export interface ComposerContext { attachments: PromptAttachment[]; goal: string; planning: boolean; debugging?: boolean; /** One-shot team planning request (ADR-043). */ team?: boolean; approvalByProvider?: Partial<Record<AgentProviderId, ApprovalMode>> }
export const emptyComposerContext: ComposerContext = { attachments: [], goal: "", planning: false };
export function composerPlanning(context: ComposerContext, planning: boolean): ComposerContext {
  const approvalByProvider = { ...context.approvalByProvider };
  if (planning) {
    for (const provider of Object.keys(approvalByProvider) as AgentProviderId[]) {
      if (approvalByProvider[provider] === "full") approvalByProvider[provider] = provider === "cursor" ? "auto" : "ask";
    }
  }
  return { ...context, planning, debugging: planning ? false : context.debugging, approvalByProvider };
}
export function composerDebugging(context: ComposerContext, debugging: boolean): ComposerContext {
  return { ...context, debugging, planning: debugging ? false : context.planning, team: debugging ? false : context.team };
}
/** A team request plans read-only by itself, so it replaces planning and debugging. */
export function composerTeam(context: ComposerContext, team: boolean): ComposerContext {
  return { ...context, team, planning: team ? false : context.planning, debugging: team ? false : context.debugging };
}
export function composerContextForOwner(owner: string, contexts: Record<string, ComposerContext>, sessions: readonly Session[]): ComposerContext {
  return contexts[owner] ?? { ...emptyComposerContext, goal: sessions.find(session => owner === `session:${session.id}`)?.goal ?? "" };
}
export function composerPrompt(prompt: string, context: ComposerContext) {
  const request = prompt.trim() || (context.attachments.length ? "Analyze the attached files." : "");
  return withPromptContext(request, context.attachments.map((attachment) => ({ label: `${attachment.kind === "folder" ? "Selected folder" : "Selected file"}: ${JSON.stringify(attachment.name)}${attachment.truncated ? " (truncated)" : ""}`, content: attachment.content })));
}
