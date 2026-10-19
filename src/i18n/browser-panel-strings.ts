/** Browser panel: agent-opened pages, local servers, annotations and project preview (ADR-151). English source, Portuguese translation. */
const strings: Record<string, [string, string]> = {
  "browser.settingsGroup": ["Browser", "Navegador"],
  "browser.showAgentPages": ["Show pages the agent opens", "Mostrar páginas que o agente abre"],
  "browser.showAgentPagesHelp": ["A page an agent opens or navigates appears in a small player over the conversation. It stays hidden while the browser panel shows that session.", "Uma página que o agente abre ou navega aparece num player pequeno sobre a conversa. Ela fica oculta enquanto o painel do navegador mostra a sessão."],
  "browser.agentPage": ["Page opened by the agent", "Página aberta pelo agente"],
  "browser.openInPanel": ["Open in panel", "Abrir no painel"],
  "browser.closePlayer": ["Close floating preview", "Fechar prévia flutuante"],
  "browser.movePlayer": ["Move preview", "Mover prévia"],
  "browser.annotationAttached": ["Annotation attached", "Anotação anexada"],
  "browser.annotationNone": ["No element was marked.", "Nenhum elemento foi marcado."],
  "browser.serverRunning": ["Running", "Rodando"],
  "scripts.previewUrl": ["Preview address", "Endereço da prévia"],
  "scripts.previewUrlHelp": ["A localhost address the script serves, such as http://localhost:5173.", "Um endereço localhost que o script serve, como http://localhost:5173."],
  "scripts.previewUrlPlaceholder": ["http://localhost:5173", "http://localhost:5173"],
  "scripts.previewInvalid": ["Use a localhost http(s) address with a port.", "Use um endereço http(s) localhost com porta."],
  "scripts.openPreview": ["Open the preview when it answers", "Abrir a prévia quando responder"],
  "scripts.openPreviewHelp": ["When a script starts and the address answers, it opens in the session's browser.", "Quando um script inicia e o endereço responde, ele abre no navegador da sessão."],
};
export const browserPanelEnglish: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[0]]));
export const browserPanelPortuguese: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[1]]));
