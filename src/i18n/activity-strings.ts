/** Sidebar Activity view. English source, Portuguese translation. */
const strings: Record<string, [string, string]> = {
  "activity.showActivity": ["Switch to activity view", "Mudar para a visão Atividade"],
  "activity.showClassic": ["Switch to project view", "Voltar para a visão por projetos"],
  "activity.all": ["All activity", "Toda atividade"],
  "activity.scope": ["Activity scope", "Escopo da atividade"],
  "activity.options": ["Activity options", "Opções da atividade"],
  "activity.newChat": ["New chat", "Nova conversa"],
  "activity.newChatHint": ["Start a new chat in the current project", "Começar uma conversa nova no projeto atual"],
  "activity.addProject": ["Add project", "Adicionar projeto"],
  "activity.done": ["Done", "Concluídas"],
  "activity.markDone": ["Done", "Concluir"],
  "activity.undoDone": ["Undo", "Desfazer"],
  "activity.markAllRead": ["Mark all as read", "Marcar tudo como lido"],
  "activity.needsYou": ["Needs you", "Precisa de você"],
  "activity.working": ["Working", "Trabalhando"],
  "activity.today": ["Today", "Hoje"],
  "activity.yesterday": ["Yesterday", "Ontem"],
  "activity.earlier": ["Earlier", "Antes"],
  "activity.unread": ["New activity", "Atividade nova"],
};
export const activityEnglish: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[0]]));
export const activityPortuguese: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[1]]));
