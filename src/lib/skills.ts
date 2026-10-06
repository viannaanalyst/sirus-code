import type { AgentSkill, AgentProviderId, AppSettings, Project, Session, SkillOwner } from "@/client/types";

export function skillContextKey(state: { sessions: Session[]; projects: Project[]; settings: AppSettings; selectedProviderAccounts: Partial<Record<AgentProviderId, string>> }, owner: SkillOwner): string {
  const session = state.sessions.find(session => session.id === owner.sessionId);
  if (owner.sessionId) return session ? `${session.agent}:${session.providerAccountId ?? "default"}:${session.worktree.path}` : "missing-session";
  if (!owner.projectId) return "global";
  const provider = state.settings.defaultAgent;
  return `${provider}:${state.selectedProviderAccounts[provider] ?? "default"}:${state.projects.find(project => project.id === owner.projectId)?.path ?? "missing-project"}`;
}

export function filterSkills(skills: readonly AgentSkill[], query: string, disabled: readonly string[] = [], enabledOnly = false) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return skills.filter(skill => (!enabledOnly || !disabled.includes(skill.name)) && words.every(word =>
    `${skill.name} ${skill.description} ${skill.sources.map(source => `${source.origin} ${source.scope} ${source.path}`).join(" ")}`.toLowerCase().includes(word)));
}
export function skillSections(skills: readonly AgentSkill[]) {
  const groups = new Map<string, AgentSkill[]>();
  for (const skill of skills) {
    const key = skill.sources.some(source => source.scope === "project") ? "project" : skill.sources.length > 1 ? "shared" : skill.sources[0]?.origin ?? "sirus";
    groups.set(key, [...(groups.get(key) ?? []), skill]);
  }
  return [...groups].sort(([a], [b]) => (a === "project" ? -2 : a === "shared" ? -1 : 0) - (b === "project" ? -2 : b === "shared" ? -1 : 0) || a.localeCompare(b));
}
export function toggleSkill(settings: AppSettings, name: string, enabled: boolean): AppSettings {
  return { ...settings, disabledSkills: enabled ? settings.disabledSkills.filter(item => item !== name) : [...new Set([...settings.disabledSkills, name])].sort() };
}
export function insertSkillInvocation(draft: string, name: string): string {
  const leading = draft.trimStart().split(/\s+/).filter(Boolean);
  const boundary = leading.findIndex(token => !token.startsWith("/"));
  if (leading.slice(0, boundary < 0 ? leading.length : boundary).some(token => token.toLowerCase() === `/${name}`)) return draft;
  return `/${name} ${draft}`;
}
