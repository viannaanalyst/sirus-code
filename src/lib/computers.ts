import type { HostInfo, Project, Session } from "@/client/types";
import { HOME_ENVIRONMENT, type Environment, type EnvironmentSummary } from "@/lib/environments";
import { cloneParent } from "@/lib/phone-projects";
import { hostKind } from "@/lib/phone-host";
import { isAuxiliarySession } from "@/lib/pull-ask";

/**
 * The desktop app's computers (ADR-133): this Mac (the `home` computer, through Tauri's IPC)
 * plus the Sirus hosts paired from Settings → Connections, the same list and tokens model as
 * the phone's (ADR-132, `lib/environments.ts`). One computer is active at a time: `client`
 * talks to it, so the whole window (transcript, composer, terminal, files, review) works on it.
 */

/**
 * Commands that always run on this Mac whatever computer is active: they act on the window,
 * its microphone, its pickers, the embedded browser, devices and remote access itself (the
 * commands a paired device may never run, ADR-080, and the desktop-only modules, ADR-131).
 */
const LOCAL_COMMANDS = new Set([
  "remote_action",
  "remote_pair",
  "pick_folder",
  "pick_executable",
  "dictation_status",
  "start_dictation",
  "stop_dictation",
  "computer_action",
  "window_snap_action",
  "take_prompt_link",
  "window_ready",
  "chat_background_action",
  "chat_background_image",
  "notification_action",
  "device_action",
  "app_update_action",
]);
const LOCAL_COMMAND_PREFIXES = ["browser_"];

/** Events that only this Mac's window raises; they keep coming from it while a server is active. */
const LOCAL_EVENTS = new Set([
  "remote-changed",
  "window-snap",
  "quit-armed",
  "prompt-link",
  "memory-pressure",
  "notification-open",
  "computer-state",
  "device-changed",
  "browser-state",
  "browser-record-request",
  "app-update",
]);

export function runsOnThisMac(command: string): boolean {
  return LOCAL_COMMANDS.has(command) || LOCAL_COMMAND_PREFIXES.some((prefix) => command.startsWith(prefix));
}

export function eventFromThisMac(event: string): boolean {
  return LOCAL_EVENTS.has(event);
}

/** The computer new projects and clones go to when the person does not choose: the last one used. */
export const LAST_TARGET_KEY = "sirus.computers.lastTarget";

export function lastTarget(storage: Pick<Storage, "getItem">, computers: readonly Pick<Environment, "id" | "token">[]): string {
  const stored = storage.getItem(LAST_TARGET_KEY);
  return computers.find((item) => item.id === stored && (item.id === HOME_ENVIRONMENT || item.token))?.id ?? HOME_ENVIRONMENT;
}

/** Where a computer is in the window's list of computers. */
export type ComputerStatus = "active" | "online" | "connecting" | "offline" | "unpaired";

export function computerStatus(id: string, activeId: string, connection: string | undefined): ComputerStatus {
  if (id === activeId) return "active";
  if (id === HOME_ENVIRONMENT) return "online";
  if (connection === "open") return "online";
  if (connection === "unauthorized") return "unpaired";
  if (connection === "lost") return "offline";
  return "connecting";
}

/** A project on a computer that is not the active one, with its conversations, newest first. */
export interface ComputerProject {
  computerId: string;
  label: string;
  kind: Environment["kind"];
  status: ComputerStatus;
  project: Project;
  sessions: Session[];
}

/**
 * The project switcher as one list across computers: another computer's project
 * with the name of one here joins that row (`alsoOn`, keyed by the project here), and its
 * conversations list with this one's; a project only there gets its own row (`elsewhere`).
 */
export function mergeComputerProjects(
  activeProjects: readonly Pick<Project, "id" | "name">[],
  computers: readonly Environment[],
  activeId: string,
  summaries: Record<string, EnvironmentSummary | undefined>,
  connection: Record<string, string | undefined>,
  label: (computer: Environment) => string,
): { alsoOn: Record<string, ComputerProject[]>; elsewhere: ComputerProject[] } {
  const key = (name: string) => name.trim().toLocaleLowerCase();
  const here = new Map(activeProjects.map((project) => [key(project.name), project.id]));
  const alsoOn: Record<string, ComputerProject[]> = {};
  const elsewhere: ComputerProject[] = [];
  for (const computer of computers) {
    if (computer.id === activeId) continue;
    const summary = summaries[computer.id];
    if (!summary) continue;
    const archived = new Set(summary.archivedSessionIds);
    const status = computerStatus(computer.id, activeId, connection[computer.id]);
    const projects = [...summary.projects].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
    for (const project of projects) {
      const sessions = summary.sessions
        .filter((session) => session.projectId === project.id && !archived.has(session.id) && !isAuxiliarySession(session) && !session.snoozedUntil)
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
      const member = { computerId: computer.id, label: label(computer), kind: computer.kind, status, project, sessions };
      const match = here.get(key(project.name));
      if (match) (alsoOn[match] ??= []).push(member);
      else elsewhere.push(member);
    }
  }
  return { alsoOn, elsewhere };
}

/** Where a clone lands on a computer: `~/Projetos` on the Mac, `~/projects` on a server. */
export function cloneParentFor(info: HostInfo | null | undefined): string {
  return cloneParent(hostKind(info));
}

/** The branch that carries a conversation's work to another computer (mirrors `session_move.rs`). */
export function moveBranch(sessionId: string): string {
  return `sirus/move-${sessionId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}`;
}

/** Why a conversation cannot move to a computer now, or null when it can. */
export type MoveRefusal = "same" | "offline" | "running" | "sideChat" | "noRemote";

export function moveRefusal(input: {
  session: Pick<Session, "status" | "sideChat" | "pullAsk">;
  sourceId: string;
  targetId: string;
  targetConnection: string | undefined;
  /** The project's GitHub address on the source; null when it has none, undefined while unknown. */
  remoteUrl?: string | null;
}): MoveRefusal | null {
  if (input.sourceId === input.targetId) return "same";
  if (input.targetId !== HOME_ENVIRONMENT && input.targetConnection !== "open") return "offline";
  if (isAuxiliarySession(input.session)) return "sideChat";
  if (["starting", "running", "waiting"].includes(input.session.status)) return "running";
  if (input.remoteUrl === null) return "noRemote";
  return null;
}

/** Compares two GitHub web addresses as the host does: case-insensitive, no `.git` or slash at the end. */
export function sameGitHubRepo(a: string, b: string): boolean {
  const normal = (url: string) => url.trim().replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase();
  return normal(a) === normal(b);
}
