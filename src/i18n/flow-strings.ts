/** Send-and-new, compact-and-send, new project from a name and provider executables. English source, Portuguese translation. */
const strings: Record<string, [string, string]> = {
  "composer.sendNewThread": ["Send and start new thread", "Enviar e começar nova conversa"],
};
export const flowEnglish: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[0]]));
export const flowPortuguese: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[1]]));
