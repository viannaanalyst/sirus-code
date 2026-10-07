/** Send-and-new, compact-and-send, new project from a name and provider executables. English source, Portuguese translation. */
const strings: Record<string, [string, string]> = {
  "composer.sendNewThread": ["Send and start new thread", "Enviar e começar nova conversa"],
  "composer.compactSend": ["Compact and send", "Compactar e enviar"],
  "composer.compactSendHint": ["This conversation is long and has been idle for over an hour, so the provider no longer has it cached. Compacting first makes the reply faster and cheaper; your message goes out as soon as it finishes. Shift-click sends without compacting.", "Esta conversa está longa e parada há mais de uma hora, então o provedor não a tem mais em cache. Compactar antes deixa a resposta mais rápida e barata; sua mensagem sai assim que terminar. Shift-clique envia sem compactar."],
  "composer.sendWithoutCompact": ["Send without compacting", "Enviar sem compactar"],
  "providers.executableLabel": ["{name} executable", "Executável do {name}"],
  "providers.executableHint": ["Which install Sirus Code runs", "Qual instalação o Sirus Code usa"],
  "providers.executableNone": ["No executable", "Nenhum executável"],
  "providers.executableCustom": ["Chosen", "Escolhido"],
  "providers.executableNoVersion": ["Version unknown", "Versão desconhecida"],
  "providers.executableChoose": ["Choose file…", "Escolher arquivo…"],
  "providers.executableAutomatic": ["Use automatic", "Usar automático"],
  "providers.executableMissing": ["Chosen executable not found", "Executável escolhido não encontrado"],
  "providers.executableFailed": ["This file did not answer as a CLI: {message}", "Este arquivo não respondeu como uma CLI: {message}"],
};
export const flowEnglish: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[0]]));
export const flowPortuguese: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[1]]));
