/** The agent plan tray above the composer (ADR-182). English source, Portuguese translation. */
const strings: Record<string, [string, string]> = {
  "plan.title": ["Agent plan", "Plano do agente"],
  "plan.progress": ["{done} of {total}", "{done} de {total}"],
  "plan.allDone": ["All done", "Tudo concluído"],
  "plan.expand": ["Show the plan", "Mostrar o plano"],
  "plan.collapse": ["Hide the plan", "Recolher o plano"],
  "plan.dismiss": ["Dismiss plan", "Dispensar plano"],
  "plan.status.pending": ["Pending", "Pendente"],
  "plan.status.inProgress": ["In progress", "Em andamento"],
  "plan.status.completed": ["Done", "Concluído"],
};
export const planEnglish: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[0]]));
export const planPortuguese: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[1]]));
