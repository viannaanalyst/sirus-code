/** Provider quota rings in the sidebar rail. English source, Portuguese translation. */
const strings: Record<string, [string, string]> = {
  "sidebarUsage.ringLabel": ["{provider}: {percent}% used · {window}", "{provider}: {percent}% usado · {window}"],
  "sidebarUsage.configure": ["Choose providers", "Escolher provedores"],
  "sidebarUsage.title": ["Usage in the sidebar", "Consumo na barra lateral"],
  "sidebarUsage.description": ["Show a usage ring for up to two providers at the bottom of the sidebar.", "Mostra um anel de consumo de até dois provedores no rodapé da barra lateral."],
  "sidebarUsage.limit": ["Up to two providers. Turn one off to choose another.", "No máximo dois provedores. Desligue um para escolher outro."],
  "sidebarUsage.notInstalled": ["Not installed", "Não instalado"],
};
export const sidebarUsageEnglish: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[0]]));
export const sidebarUsagePortuguese: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[1]]));
