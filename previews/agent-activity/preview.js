const paths = {
  chevron: '<path d="m9 5 7 7-7 7"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  terminal: '<path d="m5 7 5 5-5 5M13 17h6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  bot: '<rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M2 12h2M20 12h2M9 12v2M15 12v2M9 17h6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-1 1-2 1-2 3M12 17h.01"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  back: '<path d="m14 5-7 7 7 7M7 12h14"/>',
  forward: '<path d="m10 5 7 7-7 7M17 12H3"/>',
  sliders: '<path d="M4 6h8M16 6h4M4 12h3M11 12h9M4 18h10M18 18h2"/><circle cx="14" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="${name === 'chevron' ? 'chevron' : ''}">${paths[name] || paths.file}</svg>`;
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const root = document.documentElement;
const $ = id => document.getElementById(id);
const state = { theme: 'dark', variant: 'line', tooltip: 'shortcut', scenario: 'running', baseSeconds: 134, startedAt: performance.now(), expanded: true, questionStep: 0, selected: '', custom: '', detail: '', favorite: null, pauseAnimation: false };
const descriptions = {
  line: 'Uma linha com modelo, estado e tempo. Ferramentas e subagentes se abrem no lugar.',
  trail: 'Uma trilha conecta comentário, ferramentas e subagentes. A pergunta avança em etapas pequenas.',
  panel: 'Um painel reúne o turno. Os subagentes ficam junto ao composer e a pergunta usa opções compactas.',
};
const scenarioLabels = { running: 'trabalhando há', question: 'aguardando resposta', permission: 'aguardando permissão', completed: 'concluiu em', failed: 'falhou após', stopped: 'interrompido após' };
let noticeTimer;
function notice(text) { $('feedback').textContent = text; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('feedback').textContent = ''; }, 4200); }
function elapsedSeconds() { return state.baseSeconds + (state.scenario === 'running' ? Math.floor((performance.now() - state.startedAt) / 1000) : 0); }
function elapsedLabel(seconds = elapsedSeconds()) { return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`; }
function setScenario(scenario, resetQuestion = false) {
  state.baseSeconds = elapsedSeconds(); state.startedAt = performance.now(); state.scenario = scenario;
  if (scenario !== 'running') state.expanded = false;
  if (resetQuestion) { state.questionStep = 0; state.selected = ''; state.custom = ''; state.detail = ''; }
  render();
  if (scenario === 'question' || scenario === 'permission') $('chat-scroll').scrollTop = $('chat-scroll').scrollHeight;
}
function activeIcon() {
  if (state.scenario === 'running') return '<span class="orbit active" aria-hidden="true"></span>';
  const symbol = ({completed:'check',failed:'close',stopped:'close',question:'question',permission:'shield'})[state.scenario];
  return `<span class="state-icon ${state.scenario}">${icon(symbol)}</span>`;
}
function tools() {
  const error = state.scenario === 'failed';
  return `<details class="tools-group" ${state.variant === 'trail' ? 'open' : ''}><summary class="fold-summary">${icon('terminal')}<span>Leu 7 arquivos · Editou 2 · ${error ? '1 comando falhou' : 'Executou 3 comandos'}</span>${error ? '<span class="bad-count">1 falha</span>' : ''}${icon('chevron')}</summary><div class="step-list">
    <div class="step"><span>Leu <code>SessionPane.tsx</code></span><span class="ok">✓</span></div>
    <div class="step"><span>Leu <code>AgentRequests.tsx</code></span><span class="ok">✓</span></div>
    <div class="step"><span>Editou <code>activity-preview.css</code></span><span class="ok">✓</span></div>
    <div class="step"><code>npm run typecheck</code><span class="ok">✓ 2.3s</span></div>
    <div class="step"><code>npm test</code><span class="${error ? 'fail' : 'ok'}">${error ? '✕ saída 1' : '✓ 130 testes'}</span></div>
    ${error ? '<div class="agent-report">O teste de ordenação falhou. O agente pode revisar a falha antes de tentar novamente.</div>' : ''}
  </div></details>`;
}
function agents() {
  const isActive = state.scenario === 'running';
  const isWaiting = state.scenario === 'question' || state.scenario === 'permission';
  const isFailed = state.scenario === 'failed';
  const firstState = isActive ? 'active' : isWaiting ? 'waiting' : isFailed ? 'failed' : '';
  const firstStatus = isActive ? 'Em execução' : isWaiting ? 'Aguardando' : isFailed ? 'Falhou' : state.scenario === 'stopped' ? 'Interrompido' : 'Concluído';
  return ['interface', 'review'].map((id, index) => `<details class="agent-row"><summary class="fold-summary">${icon('bot')}<span>${index ? 'Revisão de código' : 'Interface'}</span><span class="agent-meta"><span class="status-dot ${index ? '' : firstState}"></span>${index ? 'Concluído · 6 passos' : firstStatus + ' · 8 passos'}</span>${icon('chevron')}</summary><div class="step-list"><div class="step"><span>${index ? 'GPT-6.1-Sol · revisão' : 'GPT-6.1-Sol · UI'}</span><span>${index ? '1m 12s' : elapsedLabel()}</span></div><div class="step"><span>${index ? 'Leu 4 arquivos' : 'Leu 3 arquivos'}</span><span class="ok">✓</span></div><div class="step"><span>${index ? 'Conferiu foco e teclado' : 'Editou o painel de atividade'}</span><span class="ok">✓</span></div><div class="agent-report">${index ? 'Sem problemas importantes. Os detalhes de ferramentas e subagentes permanecem acessíveis por teclado.' : isActive ? 'Ajustando o espaçamento e as opções de resposta.' : isWaiting ? 'Aguardando sua escolha para continuar.' : 'Interface finalizada. Modelo, estado e tempo ficam visíveis sem competir com a resposta.'}</div><button class="agent-open" data-agent-open="${id}">Abrir atividade deste subagente ↗</button></div></details>`).join('');
}
function renderActivity() {
  const paused = state.scenario === 'question' || state.scenario === 'permission';
  $('activity').innerHTML = `<button class="working-row" id="toggle-activity" aria-expanded="${state.expanded}" aria-controls="activity-body">${activeIcon()}<span class="model-name">GPT-6.1-Sol</span><span class="state-label ${state.scenario === 'running' ? 'live-text' : ''}">${scenarioLabels[state.scenario]}</span><span class="elapsed" data-elapsed>${elapsedLabel()}</span>${paused ? '<span class="muted">· pausado</span>' : ''}${icon('chevron')}</button>
    ${state.variant === 'panel' ? `<p class="panel-context">${scenarioLabels[state.scenario]} · ${state.scenario === 'running' ? 'Refinando a interface' : paused ? 'Sua resposta é necessária' : 'Turno encerrado'}</p>` : ''}
    <div class="activity-body" id="activity-body" ${state.expanded ? '' : 'hidden'}><p class="commentary">Vou organizar a atividade do turno e manter ferramentas, subagentes e perguntas no mesmo padrão visual.</p>${tools()}${state.variant === 'panel' ? '' : agents()}<div class="activity-summary">${icon('clock')}<span>Tempo de trabalho <span data-elapsed>${elapsedLabel()}</span>${paused ? ' · pausa para sua resposta' : ''}</span><button data-explain-time>ⓘ</button></div></div>`;
  $('composer-tray').innerHTML = state.variant === 'panel' ? `<div class="composer-tray"><details><summary class="fold-summary">${icon('bot')}<span>2 subagentes · ${state.scenario === 'running' ? '1 em execução' : paused ? '1 aguardando' : 'turno encerrado'}</span>${icon('chevron')}</summary>${agents()}</details></div>` : '';
}
function option(value, title, description, recommended = false) {
  return `<label class="answer"><input type="radio" name="tool-choice" value="${value}" ${state.selected === value ? 'checked' : ''}><span>${title}${recommended ? '<span class="recommended">recomendado</span>' : ''}<span class="answer-description">${description}</span></span></label>`;
}
function renderRequest() {
  if (state.scenario === 'permission') {
    $('request').innerHTML = `<div class="request-card"><div class="request-eyebrow">${icon('shield')}<span>Permissão necessária</span><span>GPT-6.1-Sol</span></div><h3>Executar os testes do projeto?</h3><p class="request-description">O agente quer verificar se a alteração mantém o comportamento atual.</p><div class="permission-command">npm test</div><p class="permission-path">Projeto: switchyard · ambiente local</p><div class="request-actions"><button class="secondary" data-permission="decline">Recusar</button><button class="primary" data-permission="accept">Permitir uma vez ${icon('check')}</button></div><p class="request-note">Vale apenas para este pedido. Esta prévia não executa comandos.</p></div>`;
    return;
  }
  if (state.scenario !== 'question') { $('request').innerHTML = ''; return; }
  const step = state.questionStep;
  $('request').innerHTML = `<form class="request-card" id="question-form"><div class="request-eyebrow">${icon('question')}<span>GPT-6.1-Sol precisa de uma resposta</span><span>${step + 1} de 2</span></div><h3>${step ? 'Algum detalhe para os subagentes?' : 'Como você prefere ver as ferramentas?'}</h3><p class="request-description">${step ? 'Escreva um ajuste ou use “Sem ajustes”.' : 'A escolha define como a atividade aparece enquanto o modelo trabalha.'}</p>
    ${step ? `<textarea id="question-detail" class="custom-answer" aria-label="Detalhes da apresentação dos subagentes" placeholder="Ex.: mostre o modelo e deixe os detalhes fechados…" maxlength="1000" rows="2">${escape(state.detail)}</textarea><button type="button" class="quiet-button" id="no-details">Sem ajustes</button>` : `<div class="answers">${option('grouped','Agrupadas','Uma linha, com detalhes ao expandir.',true)}${option('expanded','Sempre expandidas','Cada ferramenta aparece na conversa.')}${option('other','Outra resposta','Escreva como você prefere.')}</div><textarea id="question-custom" class="custom-answer" aria-label="Sua resposta personalizada" ${state.selected === 'other' ? '' : 'hidden'} placeholder="Sua resposta…" maxlength="1000" rows="2">${escape(state.custom)}</textarea>`}
    <div class="request-actions"><button type="button" class="secondary" ${step ? 'id="question-back"' : 'data-stop'}>${step ? '← Voltar' : 'Interromper turno'}</button><button type="submit" class="primary" id="question-submit" ${questionReady() ? '' : 'disabled'}>${step ? 'Enviar resposta' : 'Continuar'} ${icon('forward')}</button></div><p class="request-note">O modelo aguarda. Nenhuma resposta é enviada automaticamente.</p></form>`;
}
function questionReady() { return state.questionStep ? state.detail.trim().length > 0 : Boolean(state.selected && (state.selected !== 'other' || state.custom.trim())); }
function renderResponse() {
  const messages = {
    completed: '<strong>A experiência está pronta para revisão.</strong><br>Modelo, tempo e atividade ficam no topo do turno. Ferramentas e subagentes podem ser expandidos sem ocupar toda a conversa.',
    failed: '<strong>O turno encontrou uma falha.</strong><br>Os detalhes do comando ficam no grupo de ferramentas. Uma falha não aparece como tarefa concluída.',
    stopped: '<strong>Execução interrompida.</strong><br>O histórico permanece visível. Você pode reiniciar a simulação pelo controle acima.',
  };
  $('response').innerHTML = messages[state.scenario] ? `<div class="finished-response">${messages[state.scenario]}<p class="response-meta">${elapsedLabel()} de trabalho · GPT-6.1-Sol · simulação</p></div>` : '';
}
function tooltipContent(label, keys, description, style = state.tooltip) {
  return `${escape(label)}${style !== 'micro' && keys ? `<kbd>${escape(keys)}</kbd>` : ''}${style === 'context' ? `<span class="tip-context">${escape(description)}</span>` : ''}`;
}
function headerButton(name, label, keys, description) {
  const id = `tip-${name}`;
  return `<span class="tip-trigger"><button class="icon-button" aria-label="${label}" aria-describedby="${id}" data-header-action="${name}">${icon(name)}</button><span id="${id}" class="tooltip" role="tooltip">${tooltipContent(label, keys, description)}</span></span>`;
}
function renderHeader() {
  $('titlebar-actions').innerHTML = headerButton('panel','Barra lateral','⌘B','Mostrar ou ocultar os projetos.') + headerButton('back','Voltar','⌘[','Voltar para a última sessão.') + headerButton('forward','Avançar','⌘]','Avançar no histórico de navegação.');
  $('header-actions').innerHTML = headerButton('search','Buscar','⌘K','Buscar sessões e ações do app.') + headerButton('sliders','Ambiente',null,'Uso, repositório e referências da sessão.');
}
function renderTooltips() {
  $('tooltip-comparison').innerHTML = ['dark','light','glass'].map(theme => `<article class="tooltip-theme" data-surface-theme="${theme}"><h3>${({dark:'Dark',light:'Light',glass:'Translúcido'})[theme]}</h3>${['micro','shortcut','context'].map(style => `<div class="tooltip-sample"><span class="sample-label">${({micro:'01 · Micro',shortcut:'02 · Atalho',context:'03 · Contexto'})[style]}</span><span class="tooltip sample-bubble ${style}">${tooltipContent('Barra lateral','⌘B','Mostrar ou ocultar os projetos.',style)}</span></div>`).join('')}</article>`).join('');
}
function render() {
  root.dataset.theme = state.theme; root.dataset.variant = state.variant; root.dataset.tooltip = state.tooltip;
  for (const category of ['theme','variant','tooltip']) document.querySelectorAll(`[data-${category}-choice]`).forEach(button => button.setAttribute('aria-pressed', String(button.dataset[`${category}Choice`] === state[category])));
  document.querySelectorAll('[data-scenario]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scenario === state.scenario)));
  renderHeader(); renderActivity(); renderRequest(); renderResponse();
  $('direction-description').textContent = descriptions[state.variant];
  $('favorite').textContent = state.favorite?.variant === state.variant && state.favorite?.theme === state.theme && state.favorite?.tooltip === state.tooltip ? '✓ Opção marcada' : '☆ Marcar esta opção';
  $('composer-caption').textContent = state.scenario === 'question' || state.scenario === 'permission' ? 'Aguardando você · tempo de trabalho pausado' : 'Tempo decorrido de trabalho · sem timeout automático';
  $('stop-button').disabled = ['completed','stopped','failed'].includes(state.scenario);
  $('stop-button').innerHTML = $('stop-button').disabled ? '↑' : '■';
}
function openAgent(id) {
  document.querySelector('dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.className = 'agent-dialog';
  dialog.setAttribute('aria-labelledby','agent-dialog-title');
  dialog.innerHTML = `<div class="dialog-header"><span id="agent-dialog-title">${icon('bot')} ${id === 'review' ? 'Revisão de código' : 'Interface'}</span><button class="icon-button" data-close-dialog aria-label="Fechar atividade do subagente">${icon('close')}</button></div><div class="dialog-body"><p class="muted">GPT-6.1-Sol · ligado ao turno principal</p><p>Conferir os componentes e propor uma apresentação compacta.</p><details open><summary class="fold-summary">${icon('terminal')} Leu 4 arquivos · Executou 2 comandos ${icon('chevron')}</summary><div class="step-list"><div class="step"><code>AgentRequests.tsx</code><span class="ok">✓</span></div><div class="step"><code>SessionPane.tsx</code><span class="ok">✓</span></div><div class="step"><code>npm run typecheck</code><span class="ok">✓</span></div><div class="step"><code>npm test</code><span class="ok">✓</span></div></div></details><div class="agent-report">Relatório: os controles mantêm contexto, estado e acesso aos detalhes. Perguntas aguardam uma resposta explícita.</div><p class="request-note">Atividade fictícia para avaliar o layout.</p><button class="quiet-button" data-close-dialog>← Voltar ao turno principal</button></div>`;
  document.body.append(dialog); dialog.showModal();
  dialog.addEventListener('close', () => dialog.remove());
}
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  for (const category of ['theme','variant','tooltip']) {
    if (button.dataset[`${category}Choice`]) { state[category] = button.dataset[`${category}Choice`]; render(); return; }
  }
  if (button.dataset.scenario) { setScenario(button.dataset.scenario, true); return; }
  if (button.id === 'toggle-activity') { state.expanded = !state.expanded; renderActivity(); return; }
  if (button.id === 'restart') { state.baseSeconds = 0; state.startedAt = performance.now(); state.expanded = true; state.questionStep = 0; state.selected = ''; state.custom = ''; state.detail = ''; state.scenario = 'running'; render(); return; }
  if (button.id === 'stop-button' || button.hasAttribute('data-stop')) { setScenario('stopped'); notice('Turno interrompido nesta simulação.'); return; }
  if (button.id === 'question-back') { state.questionStep = 0; renderRequest(); return; }
  if (button.id === 'no-details') { state.detail = 'Sem ajustes.'; renderRequest(); return; }
  if (button.dataset.permission) { setScenario('running'); notice(button.dataset.permission === 'accept' ? 'Permissão concedida uma vez · simulação.' : 'Pedido recusado · o agente pode escolher outra ação.'); return; }
  if (button.dataset.agentOpen) { openAgent(button.dataset.agentOpen); return; }
  if (button.hasAttribute('data-close-dialog')) { button.closest('dialog').close(); return; }
  if (button.hasAttribute('data-explain-time')) { notice('Este é o tempo de trabalho. Aguardando resposta ou permissão, o contador pausa.'); return; }
  if (button.dataset.headerAction) { notice('Controle ilustrativo: passe o mouse ou use Tab para ver o tooltip.'); return; }
  if (button.id === 'favorite') {
    state.favorite = { variant:state.variant,theme:state.theme,tooltip:state.tooltip };
    try { localStorage.setItem('switchyard-activity-preview-choice',JSON.stringify(state.favorite)); } catch { /* Preview works with storage disabled. */ }
    render(); notice(`Marcado: ${({'line':'01 · Linha discreta','trail':'02 · Trilha','panel':'03 · Painel'})[state.variant]} + tooltip ${state.tooltip === 'shortcut' ? 'Atalho' : state.tooltip === 'micro' ? 'Micro' : 'Contexto'}.`);
  }
});
document.addEventListener('change', event => {
  if (event.target.name === 'tool-choice') {
    state.selected = event.target.value; renderRequest();
    document.querySelector(`input[name="tool-choice"][value="${state.selected}"]`)?.focus();
  }
});
document.addEventListener('input', event => {
  if (event.target.id === 'question-custom') state.custom = event.target.value;
  if (event.target.id === 'question-detail') state.detail = event.target.value;
  if ($('question-submit')) $('question-submit').disabled = !questionReady();
});
document.addEventListener('submit', event => {
  if (event.target.id !== 'question-form') return;
  event.preventDefault(); if (!questionReady()) return;
  if (state.questionStep === 0) { state.questionStep = 1; renderRequest(); $('question-detail')?.focus(); }
  else { setScenario('running'); notice('Resposta enviada na simulação. O modelo voltou a trabalhar.'); }
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') document.querySelectorAll('.tip-trigger').forEach(trigger => trigger.classList.add('suppressed')); });
document.addEventListener('focusin', event => event.target.closest('.tip-trigger')?.classList.remove('suppressed'));
document.addEventListener('pointerover', event => event.target.closest('.tip-trigger')?.classList.remove('suppressed'));
document.addEventListener('visibilitychange', () => document.body.classList.toggle('paused-motion', document.hidden));
const observer = new IntersectionObserver(entries => { document.body.classList.toggle('paused-motion', document.hidden || !entries[0].isIntersecting); });
observer.observe($('activity'));
setInterval(() => { if (state.scenario !== 'running' || document.hidden) return; document.querySelectorAll('[data-elapsed]').forEach(node => { node.textContent = elapsedLabel(); }); },1000);
try { state.favorite = JSON.parse(localStorage.getItem('switchyard-activity-preview-choice') || 'null'); } catch { /* Invalid saved preview choices are ignored. */ }
render(); renderTooltips();
