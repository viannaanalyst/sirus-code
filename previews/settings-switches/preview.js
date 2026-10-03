(() => {
  const designs = [
    { id: "silver", number: "01", name: "Prata suave", file: "01-prata-suave.html", description: "Deslize macio, prata acetinada e confirmação discreta." },
    { id: "metal", number: "02", name: "Metal líquido", file: "02-metal-liquido.html", description: "Esfera cromada e um reflexo que acompanha a mudança." },
    { id: "orbit", number: "03", name: "Órbita", file: "03-orbita.html", description: "Pérola prateada, órbita curta e um sinal azul suave." },
  ];
  const { icon, glyph } = window.previewAssets;
  const selected = designs.find(item => item.id === document.body.dataset.variant);
  const check = '<svg class="check" viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 6 2.2 2.2 4.8-4.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const orbit = '<svg class="orbital" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="12" rx="12" ry="4.5"/><circle cx="22.8" cy="10.1" r="1.7"/></svg>';
  const escapeText = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  function control(design, label, checked, disabled = false) {
    return `<button type="button" class="control" role="switch" aria-label="${escapeText(label)}" aria-checked="${checked}" data-initial="${checked}" data-design="${design}" ${disabled ? 'disabled' : ''}><span class="track" aria-hidden="true"><span class="track-fill"></span>${design === 'orbit' ? '<span class="signal"></span>' : ''}<span class="thumb-position"><span class="thumb">${design === 'silver' ? check : ''}${design === 'orbit' ? orbit : ''}</span></span>${design === 'metal' ? '<span class="reflection"></span>' : ''}</span></button>`;
  }
  function row(title, description, right, extra = '') {
    return `<div class="row ${extra}"><div class="row-text"><div class="row-title">${title}</div>${description ? `<div class="row-description">${description}</div>` : ''}</div>${right}</div>`;
  }
  function group(title, content) {
    return `<section class="settings-group"><h2 class="group-title">${title}</h2><div class="settings-card">${content}</div></section>`;
  }
  function segmented(label, options) {
    return `<div class="segmented" role="group" aria-label="${label}">${options.map((option, index) => `<button type="button" aria-pressed="${index === 0}" data-segment>${option}</button>`).join('')}</div>`;
  }
  const sidebar = `<aside class="sidebar"><div class="window-bar" aria-hidden="true"><span class="lights"><i></i><i></i><i></i></span>${icon.panel}${icon.left}${icon.right}</div><a class="back" href="index.html">${icon.left}<span>Voltar aos previews</span></a><p class="nav-label">Pessoal</p><div class="nav-item active">${icon.settings}Geral</div><div class="nav-item">${icon.appearance}Aparência</div><div class="nav-item">${icon.keyboard}Atalhos</div><p class="nav-label">Programação</p><div class="nav-item">${icon.providers}Provedores</div><div class="nav-item">${icon.branch}Git</div><div class="nav-item">${icon.folder}Worktrees</div><div class="nav-item">${icon.terminal}Terminal</div><p class="nav-label">Sistema</p><div class="nav-item">${icon.sliders}Avançado</div><p class="sidebar-caption">Estudo visual<br>Os ajustes ficam apenas neste preview.</p></aside>`;
  const toolbar = `<div class="toolbar"><div class="toolbar-name"><img class="logo" alt="" src="${glyph}"><span>Switchyard</span><span class="badge">/ Switches · estudo visual</span></div><div class="actions"><button class="quiet-button" type="button" data-reduce aria-pressed="false">${icon.motion}<span>Reduzir movimento</span></button><button class="quiet-button" type="button" data-reset>${icon.reset}<span>Restaurar</span></button></div></div>`;
  function card(design) {
    return `<article class="study"><header class="study-header"><span class="number">${design.number}</span><h2>${design.name}</h2><p class="study-description">${design.description}</p></header><div class="large-stage"><div class="sample">${control(design.id, `${design.name}: exemplo desligado`, false)}<span class="state-caption" data-state-caption>Desligado</span></div><div class="sample">${control(design.id, `${design.name}: exemplo ligado`, true)}<span class="state-caption" data-state-caption>Ligado</span></div></div><div class="study-body">${row('Reabrir último projeto', '', control(design.id, `${design.name}: reabrir último projeto`, true))}${row('Confirmar fechamento', '', control(design.id, `${design.name}: confirmar fechamento`, true))}${row('Abrir painel Ambiente', '', control(design.id, `${design.name}: abrir painel Ambiente`, false))}${row('Indisponível', '', control(design.id, `${design.name}: indisponível`, false, true), 'unavailable')}</div><a class="open-study" href="${design.file}"><span>Ver na página Geral</span>${icon.right}</a></article>`;
  }
  function general(design) {
    return `<div class="settings-preview"><nav class="variant-tabs" aria-label="Estilos de switch">${designs.map(item => `<a href="${item.file}" ${item.id === design.id ? 'aria-current="page"' : ''}>${item.number} · ${item.name}</a>`).join('')}</nav><p class="eyebrow">${design.name}</p><h1>Geral</h1><p class="intro">${design.description} Clique nos switches para experimentar.</p>${group('Idioma', row('Idioma', '', segmented('Idioma do preview', ['Português (Brasil)', 'English'])))}${group('Inicialização', row('Reabrir último projeto', 'Reabre o último projeto ativo ao iniciar o Switchyard.', control(design.id, 'Reabrir último projeto', true)))}${group('Sessões', row('Novas sessões', 'Escolha o comportamento para uma nova sessão.', segmented('Novas sessões do preview', ['Perguntar', 'Local', 'Worktree'])))}${group('Aplicativo', row('Confirmar fechamento', 'Pede confirmação ao fechar uma sessão com agentes em execução.', control(design.id, 'Confirmar fechamento de sessões em execução', true)) + row('Reabrir sessão mais nova', 'Retoma a seleção da sessão, sem iniciar os agentes.', control(design.id, 'Reabrir sessão mais nova', true)) + row('Atualizações do aplicativo', 'Indisponível no app atual.', control(design.id, 'Atualizações do aplicativo, indisponível', false, true), 'unavailable'))}${group('Painel Ambiente', row('Abrir por padrão', 'Mostra o painel Ambiente ao entrar em uma sessão.', control(design.id, 'Abrir painel Ambiente por padrão', false)))}<p class="hint">Estudo visual. Os cliques não alteram suas configurações.</p></div>`;
  }
  const comparison = `<p class="eyebrow">Configurações / 3 estudos</p><h1>Um gesto pequeno. Três acabamentos.</h1><p class="intro">Todos no visual do Switchyard. Clique para ligar e desligar; abra cada opção para ver o tamanho real na página Geral.</p><div class="compare">${designs.map(card).join('')}</div><div class="compare-footer"><span class="hint">Animação só ao alternar. Teclado: Tab, Espaço e Enter.</span><a class="map-link" href="mapeamento.html">Ver o mapeamento do General do Synara</a></div>`;
  document.querySelector('#app').innerHTML = `<div class="shell">${sidebar}<main class="main">${toolbar}<div class="content">${selected ? general(selected) : comparison}</div></main></div>`;
  function animate(button) {
    button.classList.remove('is-changing');
    // Restart a finite animation on a new interaction without a timer or render loop.
    void button.offsetWidth;
    button.classList.add('is-changing');
  }
  function updateCaption(button) {
    const caption = button.closest('.sample')?.querySelector('[data-state-caption]');
    if (caption) caption.textContent = button.getAttribute('aria-checked') === 'true' ? 'Ligado' : 'Desligado';
  }
  document.querySelectorAll('.control').forEach(button => {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      button.setAttribute('aria-checked', String(button.getAttribute('aria-checked') !== 'true'));
      updateCaption(button);
      animate(button);
    });
    button.addEventListener('animationend', event => {
      if (event.target.closest('.control') === button) button.classList.remove('is-changing');
    });
  });
  document.querySelectorAll('[data-segment]').forEach(button => button.addEventListener('click', () => {
    button.parentElement.querySelectorAll('[data-segment]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));
  document.querySelector('[data-reset]').addEventListener('click', () => {
    document.querySelectorAll('.control').forEach(button => {
      button.setAttribute('aria-checked', button.dataset.initial);
      button.classList.remove('is-changing');
      updateCaption(button);
    });
    document.querySelectorAll('.segmented').forEach(group => group.querySelectorAll('button').forEach((button, index) => button.setAttribute('aria-pressed', String(index === 0))));
  });
  const reduce = document.querySelector('[data-reduce]');
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let manualReduced = false;
  const updateMotion = () => {
    const reduced = manualReduced || media.matches;
    document.documentElement.dataset.reduced = String(reduced);
    reduce.setAttribute('aria-pressed', String(reduced));
    document.querySelectorAll('.is-changing').forEach(button => button.classList.remove('is-changing'));
  };
  reduce.addEventListener('click', () => { manualReduced = !manualReduced; updateMotion(); });
  media.addEventListener('change', updateMotion);
  updateMotion();
})();
