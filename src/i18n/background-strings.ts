/** Claude background subagents (ADR-097). English source, Portuguese translation. */
const strings: Record<string, [string, string]> = {
  "background.title": ["In the background", "Em segundo plano"],
  "background.running": ["{count} in the background", "{count} em segundo plano"],
  "background.interrupted": ["{count} interrupted", "{count} interrompidas"],
  "background.interrupted.one": ["1 interrupted", "1 interrompida"],
  "background.resume": ["Resume", "Retomar"],
  "background.resumeHint": ["Ask the agent to run the interrupted tasks again", "Pedir ao agente que rode de novo as tarefas interrompidas"],
  "background.resumePrompt": ["Resume the background tasks that were interrupted: {names}", "Retome as tarefas em segundo plano que foram interrompidas: {names}"],
  "background.state.running": ["Running for {duration}", "Em execução há {duration}"],
  "background.state.completed": ["Finished in {duration}", "Concluída em {duration}"],
  "background.state.failed": ["Failed", "Falhou"],
  "background.state.interrupted": ["Interrupted", "Interrompida"],
  "background.state.timedOut": ["Stopped at the time limit", "Interrompida no limite de tempo"],
  "background.unnamed": ["Background task", "Tarefa em segundo plano"],
  "background.stop": ["Stop {name}", "Parar {name}"],
};
export const backgroundEnglish: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[0]]));
export const backgroundPortuguese: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[1]]));
