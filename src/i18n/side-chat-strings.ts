/** Side chats (ADR-049). English source, Portuguese translation. */
const strings: Record<string, [string, string]> = {
  "sideChat.title": ["Side chat", "Chat lateral"],
  "sideChat.open": ["Open side chat", "Abrir chat lateral"],
  "sideChat.ask": ["Ask in side chat", "Perguntar na lateral"],
  "sideChat.delete": ["Delete side chat", "Apagar chat lateral"],
  "sideChat.transcript": ["Side chat conversation", "Conversa do chat lateral"],
  "sideChat.emptyTitle": ["Ask without interrupting", "Pergunte sem interromper"],
  "sideChat.emptyHint": ["Each question carries what the main session is doing right now. It starts read-only and uses the same workspace.", "Cada pergunta leva o que a sessão principal está fazendo agora. Começa em só leitura e usa o mesmo workspace."],
  "sideChat.takeToMain": ["Take to main chat", "Levar para o principal"],
  "sideChat.working": ["Working…", "Trabalhando…"],
  "sideChat.messages": ["{count} messages", "{count} mensagens"],
  "palette.placeholder": ["Search chats or run a command", "Buscar conversas ou executar um comando"],
  "palette.recentChats": ["Recent chats", "Conversas recentes"],
  "palette.quickActions": ["Quick actions", "Ações rápidas"],
  "palette.empty": ["Nothing found", "Nada encontrado"],
  "palette.searchChats": ["Search chats and commands", "Buscar conversas e comandos"],
};
export const sideChatEnglish: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[0]]));
export const sideChatPortuguese: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[1]]));
