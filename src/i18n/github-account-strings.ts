/** GitHub accounts in Settings → Git (ADR-188). English source, Portuguese translation. */
const strings: Record<string, [string, string]> = {
  "githubAccounts.title": ["GitHub accounts", "Contas do GitHub"],
  "githubAccounts.help": ["Pull requests, PR watches, CI fixes and HTTPS pushes use the active account. Accounts are kept by GitHub CLI (gh).", "Pull requests, acompanhamento de PRs, correção de CI e pushes por HTTPS usam a conta ativa. As contas ficam guardadas no GitHub CLI (gh)."],
  "githubAccounts.active": ["Active", "Ativa"],
  "githubAccounts.use": ["Use this account", "Usar esta conta"],
  "githubAccounts.expired": ["Sign-in expired", "Login expirado"],
  "githubAccounts.signOut": ["Sign out", "Sair"],
  "githubAccounts.signOutTitle": ["Sign out of {login}?", "Sair de {login}?"],
  "githubAccounts.signOutHelp": ["GitHub CLI forgets this account on this Mac. Sign in again to use it.", "O GitHub CLI esquece esta conta neste Mac. Entre de novo para usá-la."],
  "githubAccounts.add": ["Add account", "Adicionar conta"],
  "githubAccounts.none": ["No GitHub account signed in.", "Nenhuma conta do GitHub conectada."],
  "githubAccounts.missing": ["GitHub CLI (gh) is not installed. Install it with `brew install gh`, then add an account here.", "O GitHub CLI (gh) não está instalado. Instale com `brew install gh` e depois adicione uma conta aqui."],
  "githubAccounts.code": ["Enter this code on GitHub", "Digite este código no GitHub"],
  "githubAccounts.codeHelp": ["Sign in with the account you want to add. Sirus waits here until GitHub confirms.", "Entre com a conta que você quer adicionar. O Sirus espera aqui até o GitHub confirmar."],
  "githubAccounts.copy": ["Copy code", "Copiar código"],
  "githubAccounts.copied": ["Copied", "Copiado"],
  "githubAccounts.open": ["Open GitHub", "Abrir o GitHub"],
  "githubAccounts.waiting": ["Waiting for GitHub…", "Esperando o GitHub…"],
  "githubAccounts.cancel": ["Cancel", "Cancelar"],
};
export const githubAccountEnglish: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[0]]));
export const githubAccountPortuguese: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[1]]));
