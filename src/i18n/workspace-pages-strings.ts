/** Rail customization (ADR-052). English source, Portuguese translation. */
const strings: Record<string, [string, string]> = {
  "common.close": ["Close", "Fechar"],
  "rail.more": ["More", "Mais"],
  "rail.projects": ["Projects in the rail", "Projetos na barra"],
  "rail.noProjects": ["No projects yet", "Nenhum projeto ainda"],
  "rail.customize": ["Customize…", "Personalizar…"],
  "rail.customizeTitle": ["Customize", "Personalizar"],
  "rail.done": ["Done", "Concluído"],
  "rail.dragHint": ["Drag to reorder", "Arraste para reordenar"],
  "rail.reorderHint": ["Drag rows, or press Option + ↑/↓ on a checkbox. Home is always shown.", "Arraste as linhas ou use Option + ↑/↓ na caixa. Início sempre aparece."],
};
export const workspacePagesEnglish: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[0]]));
export const workspacePagesPortuguese: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[1]]));
