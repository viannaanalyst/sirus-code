/** In-app updates (ADR-140). English source, Portuguese translation. */
const strings: Record<string, [string, string]> = {
  "appUpdate.available": ["Sirus Code {version} is available", "Sirus Code {version} está disponível"],
  "appUpdate.update": ["Update", "Atualizar"],
  "appUpdate.later": ["Later", "Depois"],
  "appUpdate.downloading": ["Downloading Sirus Code {version}…", "Baixando o Sirus Code {version}…"],
  "appUpdate.installing": ["Installing Sirus Code {version}…", "Instalando o Sirus Code {version}…"],
  "appUpdate.installed": ["Sirus Code {version} is installed", "Sirus Code {version} foi instalado"],
  "appUpdate.installedHelp": ["Restart to start using it. It also starts the next time you open Sirus Code.", "Reinicie para começar a usar. Ele também entra na próxima vez que você abrir o Sirus Code."],
  "appUpdate.restart": ["Restart", "Reiniciar"],
  "appUpdate.failed": ["The update could not be installed", "Não foi possível instalar a atualização"],
  "appUpdate.check": ["Check for updates", "Procurar atualizações"],
  "appUpdate.checking": ["Checking…", "Procurando…"],
  "appUpdate.upToDate": ["Up to date", "Atualizado"],
  "appUpdate.versionAvailable": ["{version} available", "{version} disponível"],
  "appUpdate.percent": ["{percent}%", "{percent}%"],
  "appUpdate.restartToFinish": ["Restart to finish", "Reinicie para concluir"],
  "appUpdate.checkFailed": ["Could not check", "Não foi possível verificar"],
  "appUpdate.version": ["Version {version}", "Versão {version}"],
  "About": ["About", "Sobre"],
  "Sirus Code looks for a new version when it opens and every few hours. Updates install only when you choose.": ["Sirus Code looks for a new version when it opens and every few hours. Updates install only when you choose.", "O Sirus Code procura uma versão nova ao abrir e a cada poucas horas. Atualizações só são instaladas quando você escolhe."],
};
export const appUpdateEnglish: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[0]]));
export const appUpdatePortuguese: Record<string, string> = Object.fromEntries(Object.entries(strings).map(([key, value]) => [key, value[1]]));
