import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArrowLeft, ArrowRight, PanelLeft, Settings2, Monitor, Keyboard, Puzzle, GitBranch, FolderGit2, TerminalSquare, SlidersHorizontal, RotateCcw, Waves } from "lucide-react";

const here = new URL("./", import.meta.url);
const [css, js, glyphBytes] = await Promise.all([
  readFile(new URL("preview.css", here), "utf8"),
  readFile(new URL("preview.js", here), "utf8"),
  readFile(new URL("../../public/sirus-glyph.png", here)),
]);
const icon = Object.fromEntries(Object.entries({ left: ArrowLeft, right: ArrowRight, panel: PanelLeft, settings: Settings2, appearance: Monitor, keyboard: Keyboard, providers: Puzzle, branch: GitBranch, folder: FolderGit2, terminal: TerminalSquare, sliders: SlidersHorizontal, reset: RotateCcw, motion: Waves }).map(([name, Icon]) => [name, renderToStaticMarkup(createElement(Icon, { size: 16, strokeWidth: 1.7, "aria-hidden": true }))]));
const assets = { icon, glyph: `data:image/png;base64,${glyphBytes.toString("base64")}` };
const script = `window.previewAssets=${JSON.stringify(assets)};\n${js}`.replaceAll("</script", "<\\/script");
const pages = [["compare", "index.html", "Comparar"], ["silver", "01-prata-suave.html", "Prata suave"], ["metal", "02-metal-liquido.html", "Metal líquido"], ["orbit", "03-orbita.html", "Órbita"]];
for (const [variant, file, title] of pages) {
  await writeFile(new URL(file, here), `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Sirus Code switches</title><style>${css}</style></head><body data-variant="${variant}"><div id="app"></div><script>${script}</script></body></html>\n`);
}
const rows = [
  ["Provedor padrão", "Já temos a preferência", "Adicionar o seletor no Geral, usando os provedores e modelos reais."],
  ["Novas sessões", "Já existe", "Preservar Perguntar / Local / Worktree e a criação atual de sessões."],
  ["Excluir worktree ao arquivar", "Recurso separado", "No Sirus Code, arquivar preserva os arquivos e a execução. Requer um projeto próprio."],
  ["Tour de boas-vindas", "Ainda não existe", "Criar um tour real antes de oferecer a ação para reabri-lo."],
  ["Sidebar clássica / trilho", "Ainda não existe", "O Synara libera o trilho por uma flag beta. Hoje temos uma sidebar única."],
  ["Ordem dos projetos", "Manual já existe", "Adicionar opções por criação/atividade; manter drag e pastas fixadas primeiro."],
  ["Ordem das sessões", "Falta o seletor", "Adicionar opções por criação/atividade, preservando Fixadas."],
  ["Chats sem projeto", "Outro modelo de produto", "Nossas sessões sempre pertencem a um projeto."],
  ["Hubs", "Ainda não existe", "Depende de um recurso de grupos; no Synara também é condicional."],
  ["Sessões de automações", "Ainda não existe", "Automação está indisponível no app atual."],
  ["Ambiente: abrir por padrão", "Já existe", "Manter a preferência e o comportamento do último abrir/fechar."],
  ["Ambiente: Uso", "Dados já existem", "Adicionar visibilidade própria do Ambiente; o rodapé tem outra preferência."],
  ["Ambiente: Repositório", "Ação já existe", "Adicionar visibilidade, mantendo a validação do link no app."],
  ["Ambiente: Pull request", "Ainda não existe", "Criar dados reais de PR/CI/revisões antes de oferecer visibilidade."],
  ["Ambiente: Editor", "Ações já existem", "Adicionar visibilidade para o Editor e o seletor de editor externo."],
  ["Ambiente: Resumo", "Ainda não existe", "O recap do handoff não equivale ao resumo recorrente do Synara."],
  ["Ambiente: Mensagens fixadas", "Bookmarks já existem", "Criar a lista no painel sobre os bookmarks reais e oferecer visibilidade."],
  ["Ambiente: Instruções do projeto", "Ainda não existe", "Definir a fonte e o acesso de leitura antes de expor a seção."],
  ["Ambiente: Bloco de notas", "Ainda não existe", "Criar notas por sessão com persistência antes de oferecer o switch."],
  ["Importação Safari", "Recurso separado", "O import atual lê conversas do Claude/Codex. Não há import de navegador."],
  ["Canal Beta do app", "Ainda não existe", "As atualizações das CLIs não são um atualizador de aplicativo."],
  ["Restaurar cada preferência", "Falta o botão individual", "Usar os defaults e o salvamento existente; não resetar outras preferências."],
];
const mappingCss = `${css}\n.map-content{max-width:1050px;margin:auto;padding:44px 28px}.map-table{width:100%;border-collapse:collapse;margin:28px 0;font-size:13px}.map-table th{text-align:left;color:var(--text-muted);font-size:11px;font-weight:400}.map-table td,.map-table th{padding:14px 12px;border-bottom:1px solid var(--border);vertical-align:top;line-height:1.6}.map-table td:nth-child(2){color:var(--text-secondary);min-width:170px}.map-table td:last-child{color:var(--text-muted)}.map-table td:first-child{min-width:165px}.table-wrap{overflow-x:auto}`;
await writeFile(new URL("mapeamento.html", here), `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>General do Synara · Mapeamento Sirus Code</title><style>${mappingCss}</style></head><body><main class="map-content"><a class="quiet-button" href="index.html">${icon.left} Voltar aos previews</a><p class="eyebrow" style="margin-top:32px">Referência local · 01/10/2026</p><h1>General do Synara → Sirus Code</h1><p class="intro">Comparação do código atual. Estes itens ainda são um plano de aplicação; os previews servem para escolher o novo switch.</p><div class="table-wrap"><table class="map-table"><thead><tr><th>NO SYNARA</th><th>NO SIRUS</th><th>COMO APLICAR</th></tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div><h2>O que manter do nosso Geral</h2><p class="intro">Idioma, reabrir último projeto, confirmar fechamento de sessões em execução, reabrir sessão mais nova e a preferência do painel Ambiente.</p><h2>Ordem sugerida</h2><p class="intro">Escolher o switch → provedor padrão e reset por preferência → ordenação de pastas/sessões → visibilidade de Uso, Repositório e Editor no Ambiente.</p><p class="hint">Fontes: Synara <code>_chat.settings.tsx / renderGeneralPanel</code>, <code>settingsPanelStyles.ts</code> e componentes relacionados. Sirus Code <code>SettingsPanels.tsx</code>, <code>app-store.ts</code>, <code>settings.ts</code>, <code>sidebar-layout.ts</code> e <code>EnvironmentPanel.tsx</code>.</p></main></body></html>\n`);
console.log(`Built comparison, three standalone switch studies and the General mapping in ${fileURLToPath(here)}`);
