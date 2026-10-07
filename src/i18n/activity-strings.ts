/** Session activity markers (unread dot, Inbox "Mark all as read"). English source, Portuguese translation. */
const strings: Record<string, [string, string]> = {
  "activity.markAllRead": ["Mark all as read", "Marcar tudo como lido"],
  "activity.unread": ["New activity", "Atividade nova"],
};
export const activityEnglish: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[0]]));
export const activityPortuguese: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[1]]));
