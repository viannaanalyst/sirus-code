/** Ask about a pull request or issue on the Pull requests page (ADR-050). English source, Portuguese translation. */
const strings: Record<string, [string, string]> = {
  "pulls.ask.button": ["Ask", "Perguntar"],
  "pulls.ask.buttonHint": ["Ask an agent about this item, read-only", "Pergunte a um agente sobre este item, somente leitura"],
  "pulls.ask.title": ["Ask · {ref}", "Perguntar · {ref}"],
  "pulls.ask.label": ["Ask about {ref}", "Perguntar sobre {ref}"],
  "pulls.ask.readOnly": ["Read-only · reads GitHub with gh", "Somente leitura · lê o GitHub com gh"],
  "pulls.ask.opening": ["Opening the conversation…", "Abrindo a conversa…"],
  "pulls.ask.retry": ["Try again", "Tentar de novo"],
  "pulls.ask.emptyTitle": ["Ask about this {kind}", "Pergunte sobre este {kind}"],
  "pulls.ask.emptyHint": ["The agent reads it on GitHub with gh and changes nothing: no checkout, comment or merge.", "O agente lê no GitHub com gh e não muda nada: sem checkout, comentário ou merge."],
  "pulls.ask.kind.pullRequest": ["pull request", "pull request"],
  "pulls.ask.kind.issue": ["issue", "issue"],
  "pulls.ask.transcript": ["Ask conversation", "Conversa de perguntas"],
  "pulls.ask.clear": ["Clear conversation", "Limpar conversa"],
  "pulls.ask.clearTitle": ["Clear this conversation?", "Limpar esta conversa?"],
  "pulls.ask.clearBody": ["Its messages are deleted. Asking again starts a new conversation.", "As mensagens são apagadas. Perguntar de novo começa uma nova conversa."],
  "pulls.ask.close": ["Close Ask", "Fechar Perguntar"],
  "pulls.ask.prompt": ["Ask about this {kind}…", "Pergunte sobre este {kind}…"],
  "pulls.ask.resize": ["Resize Ask panel", "Redimensionar o painel Perguntar"],
};
export const pullAskEnglish: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[0]]));
export const pullAskPortuguese: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[1]]));
