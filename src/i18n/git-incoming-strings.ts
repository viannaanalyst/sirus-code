/** The header's Pull button (ADR-148). English source, Portuguese translation. */
const strings: Record<string, [string, string]> = {
  "gitIncoming.tooltip": ["Pull {count} commits from {upstream}", "Puxar {count} commits de {upstream}"],
  "gitIncoming.tooltip.one": ["Pull 1 commit from {upstream}", "Puxar 1 commit de {upstream}"],
  "gitIncoming.title": ["{count} new commits on {upstream}", "{count} commits novos em {upstream}"],
  "gitIncoming.title.one": ["1 new commit on {upstream}", "1 commit novo em {upstream}"],
  "gitIncoming.subtitle": ["You are on {branch} · no local commits", "Você está em {branch} · sem commits locais"],
  "gitIncoming.more": ["and {count} more", "e mais {count}"],
  "gitIncoming.commits": ["Incoming commits", "Commits que chegam"],
  "gitIncoming.button": ["Pull", "Pull"],
  "gitIncoming.pullNow": ["Pull now", "Puxar agora"],
  "gitIncoming.pulling": ["Pulling…", "Puxando…"],
  "gitIncoming.done": ["{branch} is up to date with {upstream}", "{branch} está em dia com {upstream}"],
  "gitIncoming.blocked": ["These local changes would be overwritten:", "Estas mudanças locais seriam sobrescritas:"],
  "gitIncoming.blockedHelp": ["Commit or stash these changes and try again. Nothing was changed.", "Faça commit ou stash dessas mudanças e tente de novo. Nada foi alterado."],
  "gitIncoming.diverged": ["{branch} diverged from {upstream} ({behind} there, {ahead} here). Ask the agent to integrate.", "{branch} divergiu de {upstream} ({behind} lá, {ahead} aqui). Peça ao agente para integrar."],
  "gitIncoming.now": ["now", "agora"],
  "A conversation is working in this folder. Pull when it finishes.": ["A conversation is working in this folder. Pull when it finishes.", "Uma conversa está trabalhando nesta pasta. Puxe quando ela terminar."],
  "This branch has no upstream on a remote to pull from.": ["This branch has no upstream on a remote to pull from.", "Este branch não tem um upstream remoto de onde puxar."],
  "git pull did not finish in 30 seconds.": ["git pull did not finish in 30 seconds.", "O git pull não terminou em 30 segundos."],
};
export const gitIncomingEnglish: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[0]]));
export const gitIncomingPortuguese: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[1]]));
