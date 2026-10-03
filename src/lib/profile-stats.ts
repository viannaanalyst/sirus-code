import type { AgentProviderId, LocalProfile, ProfileAvatarColor, Project, Session } from "../client/types";

export const PROFILE_COLORS: Record<ProfileAvatarColor, string> = { silver: "#9b9ea5", blue: "#478fe2", green: "#32b87a", rose: "#d77991", amber: "#c99446" };
export const defaultProfile: LocalProfile = { name: "", handle: "", avatarColor: "silver", avatarImage: null };
export function normalizeProfile(value?: Partial<LocalProfile> | null): LocalProfile {
  const name = Array.from(typeof value?.name === "string" ? value.name.trim() : "").filter(char => { const code = char.codePointAt(0)!; return code > 31 && (code < 127 || code > 159); }).slice(0, 80).join("").trim();
  const handle = (typeof value?.handle === "string" ? value.handle : "").trim().replace(/^@+/, "").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 32);
  const avatarColor = value?.avatarColor && Object.hasOwn(PROFILE_COLORS, value.avatarColor) ? value.avatarColor : "silver";
  const image = value?.avatarImage;
  const avatarImage = typeof image === "string" && image.length <= 200_000 && /^data:image\/jpeg;base64,[a-zA-Z0-9+/]+={0,2}$/.test(image) ? image : null;
  return { name, handle, avatarColor, avatarImage };
}
export function profileIdentity(profile: LocalProfile, defaultName: string) {
  const name = profile.name || defaultName || "Switchyard";
  const parts = name.split(/[\s._-]+/u).filter(Boolean);
  const initials = (parts.length >= 2 ? `${Array.from(parts[0])[0]}${Array.from(parts[1])[0]}` : Array.from(name).slice(0, 2).join("")).toLocaleUpperCase();
  const handle = profile.handle || defaultName.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 32) || "switchyard";
  return { name, handle: `@${handle}`, initials };
}
export interface ActivityCell { day: string; count: number; weekday: number; intensity: number; }
export interface ProfileStats {
  totalPrompts: number; totalSessions: number; totalProjects: number; currentStreak: number; longestStreak: number;
  heatmap: ActivityCell[]; peakHour: number | null; mostWorkedProject: { name: string; count: number } | null;
  topProvider: { provider: AgentProviderId; percent: number } | null;
  topReasoning: { effort: string; percent: number } | null;
  models: { provider: AgentProviderId; model: string | null; count: number; percent: number }[];
}
export const profileDayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const shiftProfileDay = (day: string, amount: number) => { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); };
const percent = (part: number, total: number) => total > 0 ? Math.round(part / total * 1000) / 10 : 0;

/** Retained app activity, never lifetime tokens or historical turn attribution. */
export function buildProfileStats(projects: Project[], sessions: Session[], now = new Date(), today = profileDayKey(now)): ProfileStats {
  const owned = new Map(projects.map(project => [project.id, project]));
  const retained = [...new Map(sessions.filter(session => owned.has(session.projectId)).map(session => [session.id, session])).values()];
  const daily = new Map<string, number>(), perProject = new Map<string, number>(), providers = new Map<AgentProviderId, number>(), efforts = new Map<string, number>();
  const models = new Map<string, { provider: AgentProviderId; model: string | null; count: number }>();
  const hours = Array<number>(24).fill(0);
  let totalPrompts = 0, activeSessions = 0;
  for (const session of retained) {
    if (session.importOrigin) continue; // Imported history has no durable per-message app provenance.
    const inherited = Math.max(0, Math.min(session.messages.length, Math.trunc(session.forkOrigin?.inheritedMessageCount ?? 0)));
    const seen = new Set<string>();
    let prompts = 0;
    for (const message of session.messages.slice(inherited)) {
      if (message.role !== "user" || message.sessionId !== session.id || seen.has(message.id)) continue;
      seen.add(message.id);
      const date = new Date(message.createdAt);
      if (!Number.isFinite(date.getTime()) || date.getFullYear() < 1970 || date.getTime() > now.getTime()) continue;
      const day = profileDayKey(date);
      daily.set(day, (daily.get(day) ?? 0) + 1);
      hours[date.getHours()]++;
      prompts++; totalPrompts++;
    }
    if (!prompts) continue;
    activeSessions++;
    perProject.set(session.projectId, (perProject.get(session.projectId) ?? 0) + prompts);
    providers.set(session.agent, (providers.get(session.agent) ?? 0) + 1);
    const effort = session.execution?.effort;
    if (effort) efforts.set(effort, (efforts.get(effort) ?? 0) + 1);
    const key = JSON.stringify([session.agent, session.model ?? null]);
    const entry = models.get(key) ?? { provider: session.agent, model: session.model ?? null, count: 0 };
    entry.count++; models.set(key, entry);
  }
  let streakDay = daily.has(today) ? today : shiftProfileDay(today, -1), currentStreak = 0;
  while (daily.has(streakDay)) { currentStreak++; streakDay = shiftProfileDay(streakDay, -1); }
  let longestStreak = 0, sequence = 0, previous = "";
  for (const day of [...daily.keys()].sort()) {
    sequence = previous && shiftProfileDay(previous, 1) === day ? sequence + 1 : 1;
    longestStreak = Math.max(longestStreak, sequence); previous = day;
  }
  const heatmap = Array.from({ length: 274 }, (_, index) => {
    const day = shiftProfileDay(today, index - 273);
    return { day, count: daily.get(day) ?? 0, weekday: new Date(`${day}T12:00:00Z`).getUTCDay(), intensity: 0 };
  });
  const positive = heatmap.map(cell => cell.count).filter(count => count > 0).sort((a, b) => a - b);
  for (const cell of heatmap) if (cell.count > 0) cell.intensity = Math.min(4, Math.max(1, Math.ceil(positive.filter(count => count <= cell.count).length * 4 / positive.length)));
  const top = <T extends string>(map: Map<T, number>) => [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const provider = top(providers), reasoning = top(efforts), project = top(perProject);
  return { totalPrompts, totalSessions: retained.length, totalProjects: owned.size, currentStreak, longestStreak, heatmap,
    peakHour: totalPrompts ? hours.indexOf(Math.max(...hours)) : null,
    mostWorkedProject: project ? { name: owned.get(project[0])!.name, count: project[1] } : null,
    topProvider: provider ? { provider: provider[0], percent: percent(provider[1], activeSessions) } : null,
    topReasoning: reasoning ? { effort: reasoning[0], percent: percent(reasoning[1], [...efforts.values()].reduce((a, b) => a + b, 0)) } : null,
    models: [...models.values()].sort((a, b) => b.count - a.count || `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`)).map(model => ({ ...model, percent: percent(model.count, activeSessions) })) };
}
