/** The conversation list sidebar (ADR-139). English source, Portuguese translation. */
const strings: Record<string, [string, string]> = {
  "sidebarList.label": ["Conversations", "Conversas"],
  "sidebarList.search": ["Search", "Buscar"],
  "sidebarList.order": ["List order", "Ordem da lista"],
  "sidebarList.recent": ["Recent", "Recentes"],
  "sidebarList.byProject": ["By project", "Por projeto"],
  "sidebarList.empty": ["Conversations you start will show up here", "As conversas que você começar aparecem aqui"],
  "sidebarList.resize": ["Resize the conversation list", "Redimensionar a lista de conversas"],
  "sidebarList.pulls": ["PRs", "PRs"],
  "sidebarList.newConversation": ["New conversation", "Nova conversa"],
  "sidebarList.unread": ["Unread", "Não lida"],
  "sidebarList.projectCount": ["{project}, {count} conversations", "{project}, {count} conversas"],
  "sidebarList.style": ["Sidebar style", "Estilo da barra lateral"],
  "sidebarList.styleHelp": ["The icon rail, a list of recent conversations from every project, or no sidebar. ⌘B hides and shows the chosen one.", "A barra de ícones, uma lista das conversas recentes de todos os projetos, ou nenhuma barra. ⌘B esconde e mostra a escolhida."],
  "sidebarList.styleRail": ["Icon rail", "Barra de ícones"],
  "sidebarList.styleList": ["Conversation list", "Lista de conversas"],
  "sidebarList.styleHidden": ["Hidden", "Escondida"],
  "sidebarList.orderHelp": ["Recent lists every conversation by last activity; By project groups them under their project.", "Recentes lista todas as conversas pela última atividade; Por projeto agrupa cada uma sob o seu projeto."],
};
export const sidebarListEnglish: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[0]]));
export const sidebarListPortuguese: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[1]]));
