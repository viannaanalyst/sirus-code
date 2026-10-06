import { gitWorkspaceEnglish, gitWorkspacePortuguese } from "./git-workspace-strings";
import { messages, uiEnglish, uiPortuguese } from "./ui-strings";
import { skillEnglish, skillPortuguese } from "./skill-strings";
import { documentEnglish, documentPortuguese } from "./document-strings";
import { keybindingEnglish, keybindingPortuguese } from "./keybinding-strings";
import { computerEnglish, computerPortuguese } from "./computer-strings";
import { tabsEnglish, tabsPortuguese } from "./tabs-strings";
import { astroEnglish, astroPortuguese } from "./astro-strings";
import { teamEnglish, teamPortuguese } from "./team-strings";
import { sidebarUsageEnglish, sidebarUsagePortuguese } from "./sidebar-usage-strings";
import { sideChatEnglish, sideChatPortuguese } from "./side-chat-strings";
import { activityEnglish, activityPortuguese } from "./activity-strings";
import { reviewInboxEnglish, reviewInboxPortuguese } from "./review-inbox-strings";
import { automationsEnglish, automationsPortuguese } from "./automations-strings";
import { workspacePagesEnglish, workspacePagesPortuguese } from "./workspace-pages-strings";
import { queueEnglish, queuePortuguese } from "./queue-strings";
import { splitEnglish, splitPortuguese } from "./split-strings";
import { reviewEnglish, reviewPortuguese } from "./review-strings";
import { explorerEnglish, explorerPortuguese } from "./explorer-strings";
export type Locale = "pt-BR" | "en";

const dictionaries: Record<Locale, Record<string, string>> = {
  "pt-BR": {
    ...uiPortuguese,
    ...explorerPortuguese,
    ...gitWorkspacePortuguese,
    ...skillPortuguese,
    ...documentPortuguese,
    ...reviewPortuguese,
    ...queuePortuguese,
    ...keybindingPortuguese,
    ...computerPortuguese,
    ...tabsPortuguese,
    ...astroPortuguese,
    ...teamPortuguese,
    ...sidebarUsagePortuguese,
    ...sideChatPortuguese,
    ...activityPortuguese,
    ...reviewInboxPortuguese,
    ...automationsPortuguese,
    ...workspacePagesPortuguese,
    ...splitPortuguese,
    ...Object.fromEntries(Object.entries(messages).map(([key, value]) => [key, value[1]])),
    "common.search": "Buscar",
    "Add to chat": "Adicionar ao chat",
    "Selected text actions": "Ações do texto selecionado",
    "Draft exceeds the 64 KiB limit": "O rascunho excede o limite de 64 KiB.",
    "search.conversations": "Busca nas conversas", "search.messages": "Buscar mensagens…", "search.scope": "Onde buscar", "search.current": "Nesta conversa", "search.all": "Todas as conversas", "search.previous": "Resultado anterior", "search.next": "Próximo resultado", "search.close": "Fechar busca", "search.count": "{position} / {count}{extra} resultados", "search.none": "Nenhum trecho encontrado.", "search.hint": "Digite um trecho. Enter avança; Shift+Enter volta.", "search.results": "Resultados da busca",
    "review.commentHint": "Selecione o texto ou clique no número da linha. Shift+clique amplia a seleção.", "review.selectLine": "Selecionar linha antiga {old}, nova {new}", "review.comment": "Comentário sobre o trecho", "review.clearSelection": "Limpar seleção", "review.selectedLines": "{count} linhas do diff selecionadas", "review.commentPlaceholder": "O que você quer mudar ou perguntar sobre esse trecho?", "review.commentFailed": "Não foi possível adicionar. Confira a sessão selecionada e o limite de 64 KiB do rascunho.",
    "Context": "Contexto",
    "Workspace summary": "Resumo do workspace",
    "Selected diff": "Diff selecionado",
    "Context uses the visible snapshot, up to 12 KiB. Select a changed file to include its diff.": "O contexto usa a prévia visível, até 12 KiB. Selecione um arquivo alterado para incluir o diff.",
    "sidebar.hide": "Ocultar barra lateral",
    "sidebar.show": "Mostrar barra lateral",
    "providers.title": "Provedores",
    "providers.description": "Integrações que disponibilizam modelos para sessões.",
    "providers.detectAgain": "Detectar novamente",
    "providers.back": "Provedores",
    "providers.enable": "Ativar provedor",
    "providers.enableHelp": "Desabilitar esconde o provedor para novas sessões. Sessões em execução não são encerradas.",
    "providers.installed": "Instalado",
    "providers.notDetected": "Não detectado",
    "providers.models": "Modelos",
    "providers.modelsEmpty": "Nenhum modelo listado por esta integração.",
    "providers.modelsUnknown": "Esta CLI não expõe um catálogo confiável. Os aliases abaixo vêm da documentação oficial.",
    "providers.executable": "Executável",
    "models.search": "Buscar modelos...",
    "models.loading": "Carregando catálogo de modelos…",
    "models.noMatches": "Nenhum modelo corresponde à busca.",
    "models.favorites": "Favoritos",
    "models.models": "Modelos",
    "models.available": "Disponível",
    "models.unavailable": "Indisponível",
    "models.unknown": "Desconhecido",
    "models.favorite": "Favoritar",
    "models.unfavorite": "Remover dos favoritos",
    "models.enable": "Ativar modelo",
    "models.none": "Nenhum modelo disponível neste catálogo. Use o padrão da CLI ou atualize os provedores.",
    "models.cliDefault": "Padrão da CLI",
  },
  en: {
    "search.conversations": "Conversation search", "search.messages": "Search messages…", "search.scope": "Search scope", "search.current": "This conversation", "search.all": "All conversations", "search.previous": "Previous result", "search.next": "Next result", "search.close": "Close search", "search.count": "{position} / {count}{extra} results", "search.none": "No matching text.", "search.hint": "Type a passage. Enter moves forward; Shift+Enter moves back.", "search.results": "Search results",
    "review.commentHint": "Select text or click a line number. Shift+click extends the selection.", "review.selectLine": "Select old line {old}, new line {new}", "review.comment": "Comment on selected lines", "review.clearSelection": "Clear selection", "review.selectedLines": "{count} diff lines selected", "review.commentPlaceholder": "What do you want to change or ask about this passage?", "review.commentFailed": "Could not add the comment. Check the selected session and the 64 KiB draft limit.",
    ...uiEnglish,
    ...explorerEnglish,
    ...gitWorkspaceEnglish,
    ...skillEnglish,
    ...documentEnglish,
    ...reviewEnglish,
    ...queueEnglish,
    ...keybindingEnglish,
    ...computerEnglish,
    ...tabsEnglish,
    ...astroEnglish,
    ...teamEnglish,
    ...sidebarUsageEnglish,
    ...sideChatEnglish,
    ...activityEnglish,
    ...reviewInboxEnglish,
    ...automationsEnglish,
    ...workspacePagesEnglish,
    ...splitEnglish,
    "shortcut.unsupported": "Use Command with a letter, number or punctuation. System and editing shortcuts are reserved.",
    "shortcut.conflict": "This combination belongs to another action. Choose another.",
    ...Object.fromEntries(Object.entries(messages).map(([key, value]) => [key, value[0]])),
    "common.search": "Search",
    "sidebar.hide": "Hide sidebar",
    "sidebar.show": "Show sidebar",
    "providers.title": "Providers",
    "providers.description": "Integrations that expose models for sessions.",
    "providers.detectAgain": "Detect again",
    "providers.back": "Providers",
    "providers.enable": "Enable provider",
    "providers.enableHelp": "Disabling hides the provider from new sessions. Running sessions are not stopped.",
    "providers.installed": "Installed",
    "providers.notDetected": "Not detected",
    "providers.models": "Models",
    "providers.modelsEmpty": "This integration listed no models.",
    "providers.modelsUnknown": "This CLI has no reliable catalog. Aliases below come from official documentation.",
    "providers.executable": "Executable",
    "models.search": "Search models...",
    "models.loading": "Loading model catalog…",
    "models.noMatches": "No models match your search.",
    "models.favorites": "Favorites",
    "models.models": "Models",
    "models.available": "Available",
    "models.unavailable": "Unavailable",
    "models.unknown": "Unknown",
    "models.favorite": "Favorite",
    "models.unfavorite": "Remove favorite",
    "models.enable": "Enable model",
    "models.none": "No available catalog models. Use the CLI default or refresh providers.",
    "models.cliDefault": "CLI default",
  },
};

export function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const errorMessage = /^(?:agent|git|invalid|invalid_path|not_found|persist|confirmation_required|diff|native|attachment|profile|invalid_settings): (.+)$/s.exec(key)?.[1];
  // Translate only Sirus Code's known messages, preserving raw external errors.
  const text = dictionaries[locale]?.[key] ?? dictionaries.en[key] ??
    (errorMessage ? dictionaries[locale]?.[errorMessage] ?? dictionaries.en[errorMessage] : undefined) ?? key;
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match)) : text;
}
