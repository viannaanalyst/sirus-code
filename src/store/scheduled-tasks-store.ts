import { create } from "zustand";
import { client } from "@/client";
import type { ScheduledTask, ScheduledTaskAction } from "@/client/types";
import { formatUnknownError } from "@/lib/format-error";

/**
 * Scheduled tasks (ADR-142): the native list mirrored from `scheduled_task_action` and the
 * `scheduled-tasks-changed` event (which also follows each run starting and finishing).
 */
interface ScheduledTasksState {
  tasks: ScheduledTask[] | null;
  error: string | null;
  bind: () => void;
  action: (action: ScheduledTaskAction) => Promise<ScheduledTask[] | null>;
}

let bound = false;

export const useScheduledTasks = create<ScheduledTasksState>((set) => ({
  tasks: null,
  error: null,
  bind: () => {
    if (bound) return;
    bound = true;
    void client.onScheduledTasksChanged((snapshot) => set({ tasks: snapshot.tasks }));
    void client.scheduledTaskAction({ type: "list" }).then((snapshot) => set({ tasks: snapshot.tasks }), (error: unknown) => set({ error: formatUnknownError(error) }));
  },
  action: async (action) => {
    try {
      const snapshot = await client.scheduledTaskAction(action);
      set({ tasks: snapshot.tasks, error: null });
      return snapshot.tasks;
    } catch (error) {
      set({ error: formatUnknownError(error) });
      return null;
    }
  },
}));
