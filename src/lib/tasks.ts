import type { Session, Task, TaskPriority } from "@/client/types";

export type TaskStatus = "todo" | "running" | "needs" | "review" | "stopped" | "done";
export const PRIORITIES: TaskPriority[] = ["urgent", "high", "medium", "low", "none"];
const RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

/** A task's status comes from its linked session; done is the person's call. */
export function taskStatus(task: Task, sessions: readonly Pick<Session, "id" | "status">[]): TaskStatus {
  if (task.completedAt) return "done";
  const session = task.sessionId ? sessions.find((item) => item.id === task.sessionId) : undefined;
  if (!session) return "todo";
  if (session.status === "waiting") return "needs";
  if (session.status === "running" || session.status === "starting") return "running";
  if (session.status === "failed" || session.status === "stopped") return "stopped";
  if (session.status === "completed") return "review";
  return "todo";
}

/** Priority first, then the nearest due date, then the oldest. */
export function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => RANK[a.priority] - RANK[b.priority]
    || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")
    || a.createdAt.localeCompare(b.createdAt));
}

export const SECTIONS: { key: string; statuses: TaskStatus[] }[] = [
  { key: "tasks.section.needs", statuses: ["needs"] },
  { key: "tasks.section.running", statuses: ["running"] },
  { key: "tasks.section.review", statuses: ["review", "stopped"] },
  { key: "tasks.section.todo", statuses: ["todo"] },
  { key: "tasks.section.done", statuses: ["done"] },
];

export function groupTasks(tasks: readonly Task[], sessions: readonly Pick<Session, "id" | "status">[]) {
  const sorted = sortTasks(tasks);
  return SECTIONS.map((section) => ({ ...section, tasks: sorted.filter((task) => section.statuses.includes(taskStatus(task, sessions))) }))
    .filter((section) => section.tasks.length > 0);
}

/** Overdue when the due date is before today (local). */
export function overdue(task: Task, today = new Date()): boolean {
  if (!task.dueDate || task.completedAt) return false;
  const pad = (value: number) => String(value).padStart(2, "0");
  return task.dueDate < `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}
