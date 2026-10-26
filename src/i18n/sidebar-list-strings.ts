/** The conversation list sidebar (ADR-139). English source, Portuguese translation. */
const strings: Record<string, [string, string]> = {
  "sidebarList.label": ["Conversations", "Conversas"],
  "sidebarList.search": ["Search", "Buscar"],
  "sidebarList.order": ["List order", "Ordem da lista"],
  "sidebarList.recent": ["Recent", "Recentes"],
  "sidebarList.byProject": ["By project", "Por projeto"],
  "sidebarList.empty": ["Conversations you start will show up here", "As conversas que você começar aparecem aqui"],
  "sidebarList.pulls": ["PRs", "PRs"],
  "sidebarList.newConversation": ["New conversation", "Nova conversa"],
  "sidebarList.unread": ["Unread", "Não lida"],
  "sidebarList.showMore": ["Show {count} more", "Mostrar mais {count}"],
  "sidebarList.showLess": ["Show less", "Mostrar menos"],
  "sidebarList.projectCount": ["{project}, {count} conversations", "{project}, {count} conversas"],
  "sidebarList.style": ["Sidebar style", "Estilo da barra lateral"],
  "sidebarList.styleHelp": ["How the sidebar shows. ⌘S hides and shows the chosen one.", "Como a barra lateral aparece. ⌘S mostra e esconde a escolhida."],
  "sidebarList.styleRail": ["Icon rail", "Barra de ícones"],
  "sidebarList.styleRailHelp": ["52 px icons; conversations in the tabs", "Ícones de 52 px; conversas nas abas"],
  "sidebarList.styleList": ["Conversation list", "Lista de conversas"],
  "sidebarList.styleListHelp": ["Every conversation, from every project", "Todas as conversas, de todos os projetos"],
  "sidebarList.orderHelp": ["Recent lists every conversation by last activity; By project shows one folder per project, opened with a click.", "Recentes lista todas as conversas pela última atividade; Por projeto mostra uma pasta por projeto, aberta com um clique."],
  "sidebarList.hover.working": ["Working", "Trabalhando"],
  "sidebarList.hover.needsYou": ["Needs you", "Precisa de você"],
  "sidebarList.hover.failed": ["Failed", "Falhou"],
};
export const sidebarListEnglish: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[0]]));
export const sidebarListPortuguese: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[1]]));
