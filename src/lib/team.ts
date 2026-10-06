import type { Session, Team, TeamTask } from "@/client/types";

const PLAN_OPEN = "<sirus_team_plan>";
const PLAN_CLOSE = "</sirus_team_plan>";

/** Hides the coordinator's machine-readable plan block (also while it streams). */
export function stripTeamPlan(text: string): string {
  const start = text.indexOf(PLAN_OPEN);
  if (start < 0) return text;
  const end = text.indexOf(PLAN_CLOSE, start);
  const after = end < 0 ? "" : text.slice(end + PLAN_CLOSE.length);
  return `${text.slice(0, start)}${after}`.trim();
}

export const liveTeam = (team: Team | null | undefined) => Boolean(team && ["planning", "proposed", "running", "ready"].includes(team.status));

/** Worker sessions follow their coordinator in a list; returns rows with a child flag. */
export function nestTeamSessions(sessions: readonly Session[]): { session: Session; child: boolean }[] {
  const ids = new Set(sessions.map(session => session.id));
  const children = new Map<string, Session[]>();
  for (const session of sessions) {
    const parent = session.teamWorker?.coordinatorSessionId;
    if (parent && ids.has(parent)) children.set(parent, [...(children.get(parent) ?? []), session]);
  }
  const rows: { session: Session; child: boolean }[] = [];
  for (const session of sessions) {
    const parent = session.teamWorker?.coordinatorSessionId;
    if (parent && ids.has(parent)) continue;
    rows.push({ session, child: false });
    for (const child of children.get(session.id) ?? []) rows.push({ session: child, child: true });
  }
  return rows;
}

/** Display state of one task, combining its plan state with its worker's live session. */
export type TaskView = "pending" | "queued" | "running" | "needs" | "done" | "failed" | "stopped";
export function taskView(task: TeamTask, worker: Session | undefined): TaskView {
  if (task.state === "running") {
    if (worker?.status === "waiting") return "needs";
    return worker && (worker.status === "running" || worker.status === "starting") ? "running" : "queued";
  }
  return task.state;
}

/** Totals from the worker's latest native change review, when it reported one. */
export function workerChanges(worker: Session | undefined): { files: number; additions: number; deletions: number } | null {
  const review = [...(worker?.messages ?? [])].reverse().find(message => message.role === "agent" && message.activity?.review)?.activity?.review;
  if (!review) return null;
  return review.files.reduce((total, file) => ({ files: total.files + 1, additions: total.additions + file.additions, deletions: total.deletions + file.deletions }), { files: 0, additions: 0, deletions: 0 });
}
