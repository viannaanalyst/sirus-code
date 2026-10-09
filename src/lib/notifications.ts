import type { ActivityNotification, AppSettings, NotificationPreferences, NotificationSound } from "@/client/types";

export const NOTIFICATION_SOUNDS = ["glass", "ping", "pop", "submarine", "tink", "hero"] as const satisfies readonly NotificationSound[];
export const defaultNotifications: NotificationPreferences = {
  toasts: true, system: true, sounds: true, foreground: false,
  permissions: true, questions: true, completion: true,
  permissionSound: "ping", questionSound: "pop", completionSound: "glass",
};
export function normalizeNotifications(value?: Partial<NotificationPreferences> | null): NotificationPreferences {
  const result = { ...defaultNotifications };
  for (const key of ["toasts", "system", "sounds", "foreground", "permissions", "questions", "completion"] as const) {
    if (typeof value?.[key] === "boolean") result[key] = value[key];
  }
  for (const key of ["permissionSound", "questionSound", "completionSound"] as const) {
    if (NOTIFICATION_SOUNDS.includes(value?.[key] as NotificationSound)) result[key] = value![key]!;
  }
  return result;
}
export function resetNotificationSettings(settings: AppSettings): AppSettings {
  return { ...settings, notifications: { ...defaultNotifications } };
}
export function notificationLifetime(notice: ActivityNotification) { return notice.kind === "completion" ? 6500 : 12000; }
/** Snooze reminders (ADR-103) were asked for, so only the toasts channel hides them. */
export function retainActivityNotifications(notices: ActivityNotification[], prefs: NotificationPreferences, now = Date.now()) {
  return notices.filter(notice => prefs.toasts && (notice.kind === "permission" ? prefs.permissions : notice.kind === "question" ? prefs.questions : notice.kind === "reminder" || prefs.completion)
    && Number.isFinite(notice.createdAt) && now < notice.createdAt + notificationLifetime(notice)).slice(-8);
}
