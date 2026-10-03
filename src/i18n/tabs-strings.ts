/** Header tabs and project switcher. English source, Portuguese translation. */
const strings: Record<string, [string, string]> = {
  "tabs.label": ["Open sessions", "Sessões abertas"],
  "tabs.actions": ["Tab actions", "Ações da guia"],
  "tabs.close": ["Close tab", "Fechar guia"],
  "tabs.closeNamed": ["Close {title}", "Fechar {title}"],
  "tabs.closeOthers": ["Close other tabs", "Fechar outras guias"],
  "tabs.closeRight": ["Close tabs to the right", "Fechar guias à direita"],
  "tabs.reopen": ["Reopen closed tab", "Reabrir guia fechada"],
  "tabs.closedToast": ["Closed “{title}” — the session stays in the sidebar.", "“{title}” fechada — a sessão continua na sidebar."],
  "tabs.undo": ["Undo", "Desfazer"],
  "tabs.more": ["{count} more tabs", "Mais {count} guias"],
  "tabs.switchProject": ["Switch project", "Trocar de projeto"],
  "tabs.searchProjects": ["Search projects…", "Buscar projetos…"],
  "tabs.projects": ["Projects", "Projetos"],
  "tabs.noProjects": ["No projects match.", "Nenhum projeto encontrado."],
  "tabs.count": ["{count} tabs", "{count} guias"],
  "tabs.countOne": ["1 tab", "1 guia"],
  "tabs.waitingElsewhere": ["A session in another project is waiting for you", "Uma sessão em outro projeto está esperando você"],
  "tabs.status.running": ["Agent running", "Agente rodando"],
  "tabs.status.waiting": ["Waiting for you", "Esperando você"],
  "tabs.status.done": ["Finished — not seen yet", "Terminou — ainda não visto"],
  "tabs.status.idle": ["Idle", "Parado"],
};
export const tabsEnglish: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[0]]));
export const tabsPortuguese: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[1]]));
