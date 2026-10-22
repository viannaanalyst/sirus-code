import { create } from "zustand";
import { client } from "@/client";
import type { ScheduledTask, ScheduledTaskAction, ScheduledTaskWebhookReveal } from "@/client/types";
import { formatUnknownError } from "@/lib/format-error";

/**
 * Scheduled tasks (ADR-142): the native list mirrored from `scheduled_task_action` and the
 * `scheduled-tasks-changed` event (which also follows each run starting and finishing).
 */
interface ScheduledTasksState {
  tasks: ScheduledTask[] | null;
  error: string | null;
  /** A webhook URL the last action made (ADR-161); shown once, never sent again. */
  reveal: ScheduledTaskWebhookReveal | null;
  bind: () => void;
  action: (action: ScheduledTaskAction) => Promise<ScheduledTask[] | null>;
  clearReveal: () => void;
}

let bound = false;

export const useScheduledTasks = create<ScheduledTasksState>((set) => ({
  tasks: null,
  error: null,
  reveal: null,
  bind: () => {
    if (bound) return;
    bound = true;
    void client.onScheduledTasksChanged((snapshot) => set({ tasks: snapshot.tasks }));
    void client.scheduledTaskAction({ type: "list" }).then((snapshot) => set({ tasks: snapshot.tasks }), (error: unknown) => set({ error: formatUnknownError(error) }));
  },
  action: async (action) => {
    try {
      const snapshot = await client.scheduledTaskAction(action);
      set({ tasks: snapshot.tasks, error: null, ...(snapshot.webhook ? { reveal: snapshot.webhook } : {}) });
      return snapshot.tasks;
    } catch (error) {
      set({ error: formatUnknownError(error) });
      return null;
    }
  },
  clearReveal: () => set({ reveal: null }),
}));
