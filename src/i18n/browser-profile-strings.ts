/** Browser profiles and agent dialogs (ADR-150). English source, Portuguese translation. */
const strings: Record<string, [string, string]> = {
  "browser.profiles": ["Browser profiles", "Perfis do navegador"],
  "browser.profilesHelp": ["Each profile keeps its own cookies and sign-ins. Private profiles forget everything when the browser closes.", "Cada perfil guarda seus próprios cookies e logins. Perfis privados esquecem tudo quando o navegador fecha."],
  "browser.profileDefault": ["Default", "Padrão"],
  "browser.profilePrivate": ["Private", "Privado"],
  "browser.profilePrivateHelp": ["Cookies and site data last only while the browser is open.", "Cookies e dados dos sites duram só enquanto o navegador estiver aberto."],
  "browser.profileAdd": ["Add profile", "Adicionar perfil"],
  "browser.profileNamePlaceholder": ["Profile name", "Nome do perfil"],
  "browser.profileNameInvalid": ["Use a short name that is not already taken, Default or Private.", "Use um nome curto que ainda não existe, nem Padrão nem Privado."],
  "browser.profileBuiltIn": ["Built in", "Integrado"],
  "browser.profileRename": ["Rename profile", "Renomear perfil"],
  "browser.profileDelete": ["Delete profile", "Excluir perfil"],
  "browser.profileDeleteTitle": ["Delete {name}?", "Excluir {name}?"],
  "browser.profileDeleteHelp": ["Its cookies, sign-ins and site data are removed from this Mac, and its tabs close.", "Os cookies, logins e dados dos sites são removidos deste Mac, e as abas dele fecham."],
  "browser.profileDefaultForTabs": ["New tabs open in", "Novas abas abrem em"],
  "browser.profileDefaultForTabsHelp": ["The profile a new tab uses unless you pick another from the + menu.", "O perfil usado por uma nova aba, a não ser que você escolha outro no menu +."],
  "browser.profileNeedsMacOS": ["Custom profiles need macOS 14 or later.", "Perfis personalizados precisam do macOS 14 ou mais recente."],
  "browser.profileLimit": ["Keep at most 10 custom profiles.", "Mantenha no máximo 10 perfis personalizados."],
  "browser.newTabIn": ["New tab in profile", "Nova aba no perfil"],
  "browser.dialogAlert": ["The page says", "A página diz"],
  "browser.dialogConfirm": ["The page asks you to confirm", "A página pede confirmação"],
  "browser.dialogPrompt": ["The page asks for a value", "A página pede um valor"],
  "browser.dialogOk": ["OK", "OK"],
  "browser.dialogCancel": ["Cancel", "Cancelar"],
};
export const browserProfileEnglish: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[0]]));
export const browserProfilePortuguese: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[1]]));
