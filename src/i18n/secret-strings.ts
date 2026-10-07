/** Private secret requests (ADR-077). English source, Portuguese translation. */
const strings: Record<string, [string, string]> = {
  "secret.title": ["{provider} asks for {label}", "{provider} pede {label}"],
  "secret.private": ["Private: the agent never sees the value. It stays in memory until this turn ends and is never saved or shown in the conversation.", "Privado: o agente nunca vê o valor. Ele fica na memória até o fim deste turno e nunca é salvo nem mostrado na conversa."],
  "secret.writesTo": ["Will be written to {path}", "Será gravado em {path}"],
  "secret.variable": ["Variable {name}", "Variável {name}"],
  "secret.value": ["Value", "Valor"],
  "secret.show": ["Show value", "Mostrar valor"],
  "secret.hide": ["Hide value", "Ocultar valor"],
  "secret.provide": ["Provide", "Fornecer"],
  "secret.decline": ["Decline", "Recusar"],
  "secret.failed": ["The value could not be sent. The request may have expired.", "Não foi possível enviar o valor. O pedido pode ter expirado."],
  "timeline.secretProvided": ["Secret provided ({label})", "Segredo fornecido ({label})"],
};
export const secretEnglish: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[0]]));
export const secretPortuguese: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[1]]));
