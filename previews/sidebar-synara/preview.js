import { freshState, hasDraft, groups, updateDraft, select, newSession } from "./state.mjs";
const paths={home:'<path d="m3 10 9-7 9 7v10H6V10m3 10v-6h6v6"/>',inbox:'<path d="m5 4-3 10v6h20v-6L19 4ZM2 14h6l2 3h4l2-3h6"/>',tasks:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',pr:'<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v10m12 0V8a3 3 0 0 0-3-3h-3m3-3-3 3 3 3"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',grid:'<rect x="3" y="3" width="6" height="6" rx="2"/><rect x="15" y="3" width="6" height="6" rx="2"/><rect x="3" y="15" width="6" height="6" rx="2"/><rect x="15" y="15" width="6" height="6" rx="2"/>',more:'<circle cx="4" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="20" cy="12" r="1"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="m10 3-1 3-3 1-3 3 2 3-1 4 4 1 2 3 4-1 3 1 2-4 3-2-1-4-3-1-2-4z"/>',new:'<path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M14 3l7 7m-7-7-7 7v7h7l7-7a5 5 0 0 0-7-7Z"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',note:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h7M8 12h7M8 16h4"/>',right:'<path d="m9 5 7 7-7 7"/>',sort:'<path d="M7 21V3m-4 4 4-4 4 4M17 3v18m-4-4 4 4 4-4"/>',branch:'<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10m0-5h8a4 4 0 0 0 4-4V7"/>',workspace:'<path d="m8 4-4 4 4 4m8 0 4 4-4 4M4 8h12v8H4"/>',panel:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',back:'<path d="m10 5-7 7 7 7M3 12h18"/>',tool:'<path d="m14 7 3 3 4-4a7 7 0 0 1-9 9l-6 6-3-3 6-6a7 7 0 0 1 9-9z"/>',copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',up:'<path d="M12 19V5m-6 6 6-6 6 6"/>',pencil:'<path d="m16 3 5 5M4 20l4-1L21 6a2.8 2.8 0 0 0-4-4L4 15l-1 6z"/>'};
const glyph=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
document.querySelectorAll('[data-glyph]').forEach(node=>node.insertAdjacentHTML('afterbegin',glyph(node.dataset.glyph)));
const $=id=>document.getElementById(id);
let state=freshState();const history=[];const threads=$('threads');const composer=$('composer');const media=matchMedia('(prefers-color-scheme: dark)');
function palette(){const mode=document.querySelector('input[name="theme"]:checked').value;document.documentElement.dataset.theme=mode==='system'?media.matches?'dark':'light':mode;}
media.addEventListener('change',palette);document.querySelectorAll('input[name="theme"]').forEach(input=>input.addEventListener('change',palette));
$('glass').addEventListener('change',event=>{document.documentElement.dataset.glass=event.target.checked?'on':'off';});
function renderList(){
 const focusedId=threads.contains(document.activeElement)?document.activeElement.dataset.id:null;
 threads.replaceChildren();let count=0;
 for(const group of groups(state)){
  const heading=document.createElement('h3');heading.textContent=group.name;threads.append(heading);
  for(const session of group.rows){
   count++;const row=document.createElement('button');row.type='button';row.className='thread';row.dataset.id=session.id;row.setAttribute('aria-current',session.id===state.active?'page':'false');row.title=session.title;
   const first=document.createElement('span');first.className='thread-first';
   const brand=document.createElement('img');brand.src=`assets/${session.icon}.svg`;brand.alt='';brand.className=session.mono?'mono':'';
   const title=document.createElement('span');title.className='thread-title';title.textContent=session.title;first.append(brand,title);
   if(hasDraft(state,session.id)){const pencil=document.createElement('span');pencil.className='draft-pencil';pencil.innerHTML=glyph('pencil');pencil.setAttribute('role','img');pencil.setAttribute('aria-label','Rascunho não enviado');pencil.title='Rascunho não enviado';first.append(pencil);}
   else if(session.running){const spinner=document.createElement('span');spinner.className='thread-spinner';spinner.setAttribute('role','img');spinner.setAttribute('aria-label','Em execução');first.append(spinner);}
   const second=document.createElement('span');second.className='thread-second';
   const project=document.createElement('span');project.className='project-chip';project.innerHTML='<img src="assets/switchyard.svg" alt="">';const name=document.createElement('span');name.textContent=session.project;project.append(name);second.append(project);
   if(session.branch!=='main'){const workspace=document.createElement('span');workspace.className='workspace-glyph';workspace.innerHTML=glyph('workspace');workspace.title='Worktree de exemplo';second.append(workspace);}
   if(session.pr){const pr=document.createElement('span');pr.className=`pr-chip ${session.prState}`;pr.innerHTML=glyph('pr');const number=document.createElement('span');number.textContent=`#${session.pr}`;pr.append(number);second.append(pr);}
   const branch=document.createElement('span');branch.className='branch-chip';branch.innerHTML=glyph('branch');const label=document.createElement('span');label.textContent=session.branch;branch.append(label);second.append(branch);
   row.append(first,second);row.addEventListener('click',()=>{history.push(state.active);composer.value=select(state,session.id);renderSelection();renderList();$('feedback').textContent=hasDraft(state,session.id)?'Rascunho recuperado nesta sessão.':'Sessão selecionada na prévia.';});threads.append(row);
  }
 }
 if(!count){const empty=document.createElement('p');empty.className='empty';empty.textContent='Nenhuma sessão neste filtro.';threads.append(empty);}
 $('list-count').textContent=`${count} ${count===1?'sessão':'sessões'}`;
 const drafts=state.sessions.some(row=>hasDraft(state,row.id));$('drafts-toggle').classList.toggle('has-drafts',drafts);
 if(focusedId)threads.querySelector(`[data-id="${focusedId}"]`)?.focus();
}
function renderSelection(){const row=state.sessions.find(row=>row.id===state.active);$('session-title').textContent=row.title;$('session-project').textContent=`${row.project} · ${row.branch}`;$('model-name').textContent=row.model;$('composer-model').textContent=row.model;$('send').disabled=!hasDraft(state,row.id);$('clear').disabled=!hasDraft(state,row.id);}
function scope(value){state.scope=value;$('scope-label').textContent=({all:'Toda atividade',drafts:'Rascunhos',switchyard:'Switchyard',fisioae:'Fisioae'})[value];document.querySelectorAll('details.workspace-picker,details.scope-picker').forEach(node=>{const restore=node.contains(document.activeElement);node.open=false;if(restore)node.querySelector('summary')?.focus();});renderList();}
document.querySelectorAll('[data-scope]').forEach(button=>button.addEventListener('click',()=>scope(button.dataset.scope)));
$('search-toggle').addEventListener('click',()=>{const open=$('search-wrap').hidden;$('search-wrap').hidden=!open;$('search-toggle').setAttribute('aria-expanded',String(open));if(open)$('search').focus();else{state.query='';$('search').value='';renderList();}});
$('search').addEventListener('input',event=>{state.query=event.target.value;renderList();});
$('sort').addEventListener('click',()=>{state.ascending=!state.ascending;renderList();$('feedback').textContent=state.ascending?'Ordem: mais antigas primeiro.':'Ordem: mais recentes primeiro.';});
$('drafts-toggle').addEventListener('click',()=>scope(state.scope==='drafts'?'all':'drafts'));
composer.addEventListener('input',()=>{updateDraft(state,composer.value);renderSelection();renderList();});
for(const id of ['clear','send'])$(id).addEventListener('click',()=>{updateDraft(state,'');composer.value='';renderSelection();renderList();$('feedback').textContent=id==='send'?'Envio simulado. Nenhum modelo foi acionado.':'Rascunho removido desta sessão.';});
$('new-session').addEventListener('click',()=>{history.push(state.active);newSession(state);composer.value='';$('search').value='';scope('all');renderSelection();composer.focus();$('feedback').textContent='Nova sessão de exemplo. Escreva para criar um rascunho.';});
$('back').addEventListener('click',()=>{const id=history.pop();if(id){composer.value=select(state,id);renderSelection();renderList();}});
const app=document.querySelector('.app');const panel=$('panel');let panelSection='home',peekSection=null,revision=0,leaveTimer=null,overPanel=false,keyboardPanel=false,suppressRailFocus=false;
const sectionNames={home:'Switchyard',project:'Projetos',board:'Kanban',archived:'Sessões arquivadas',settings:'Configurações'};
function stopClose(){clearTimeout(leaveTimer);leaveTimer=null;}
function renderPanel(){
 const collapsed=app.classList.contains('panel-collapsed');const visible=!collapsed||peekSection!==null;const view=peekSection??panelSection;
 app.classList.toggle('panel-peeking',collapsed&&visible);panel.inert=!visible;
 $('toggle-panel').setAttribute('aria-expanded',String(!collapsed));$('toggle-panel').setAttribute('aria-label',collapsed?'Expandir sidebar':'Recolher sidebar');
 $('pin-panel').setAttribute('aria-label',collapsed?'Fixar sidebar':'Recolher sidebar');$('pin-panel').title=collapsed?'Fixar sidebar':'Recolher sidebar';$('pin-panel').setAttribute('aria-pressed',String(!collapsed));
 document.querySelectorAll('[data-view]').forEach(button=>{button.setAttribute('aria-expanded',String(visible&&button.dataset.view===view));button.setAttribute('aria-controls','panel');button.setAttribute('aria-current',view===button.dataset.view?'page':'false');});
 const home=view==='home';document.querySelector('.workspace-picker').hidden=!home;$('section-title').hidden=home;$('section-title').textContent=sectionNames[view];
 for(const node of [document.querySelector('.thread-scroll'),document.querySelector('.activity-toolbar'),$('new-session'),$('search-toggle'),$('drafts-toggle'),document.querySelector('.sidebar-footer')])node.hidden=!home;
 if(!home)$('search-wrap').hidden=true;
 const other=$('section-preview');other.hidden=home;other.replaceChildren();
 const entries=view==='project'?['Switchyard · 4 sessões','Fisioae · 2 sessões']:view==='board'?['Switchyard','Fisioae']:view==='archived'?['Revisão anterior · exemplo arquivado']:view==='settings'?['Geral','Perfil','Aparência','Notificações','Provedores','Agent skills','Atalhos']:[];
 for(const label of entries){const button=document.createElement('button');button.className='section-link';button.textContent=label;button.addEventListener('click',()=>{$('feedback').textContent=`${label} · ação simulada na prévia.`;});other.append(button);}
}
function dismissPeek(restore=false){const target=peekSection??panelSection;stopClose();peekSection=null;revision++;renderPanel();if(restore){suppressRailFocus=true;document.querySelector(`[data-view="${target}"]`)?.focus();suppressRailFocus=false;}}
function closeSoon(){stopClose();const scheduled=revision;leaveTimer=setTimeout(()=>{if(scheduled!==revision||overPanel||(keyboardPanel&&panel.contains(document.activeElement))||panel.querySelector('details[open]'))return;dismissPeek();},180);}
function openSection(button){stopClose();const view=button.dataset.view;if(app.classList.contains('panel-collapsed'))peekSection=view;else panelSection=view;revision++;renderPanel();}
$('toggle-panel').addEventListener('click',()=>{stopClose();app.classList.toggle('panel-collapsed');peekSection=null;revision++;renderPanel();});
$('pin-panel').addEventListener('click',()=>{stopClose();if(app.classList.contains('panel-collapsed')){panelSection=peekSection??panelSection;app.classList.remove('panel-collapsed');}else app.classList.add('panel-collapsed');peekSection=null;revision++;suppressRailFocus=true;document.querySelector(`[data-view="${panelSection}"]`)?.focus();suppressRailFocus=false;renderPanel();$('feedback').textContent=app.classList.contains('panel-collapsed')?'Sidebar recolhida. Passe o mouse nos ícones.':'Painel fixado. Ele permanece aberto ao tirar o mouse.';});
for(const element of [$('rail'),panel]){
 element.addEventListener('pointerenter',()=>{overPanel=true;stopClose();});element.addEventListener('pointerleave',()=>{overPanel=false;closeSoon();});element.addEventListener('pointermove',()=>{keyboardPanel=false;});element.addEventListener('keydown',event=>{keyboardPanel=true;if(event.key==='Escape'&&peekSection){event.preventDefault();dismissPeek(true);}});element.addEventListener('focusout',closeSoon);element.addEventListener('focusin',stopClose);
}
document.querySelectorAll('[data-view]').forEach(button=>{
 button.addEventListener('pointerenter',()=>{if(app.classList.contains('panel-collapsed'))openSection(button);});button.addEventListener('focus',()=>{if(!suppressRailFocus){keyboardPanel=true;openSection(button);}});button.addEventListener('click',()=>openSection(button));button.addEventListener('keydown',event=>{if(event.key==='ArrowRight'){event.preventDefault();openSection(button);$('pin-panel').focus();}});
});
renderPanel();
$('activity-toggle').addEventListener('click',()=>{const expanded=$('activity-toggle').getAttribute('aria-expanded')!=='true';$('activity-toggle').setAttribute('aria-expanded',String(expanded));$('activity-details').hidden=!expanded;});
$('reset').addEventListener('click',()=>{state=freshState();history.length=0;composer.value='';$('search').value='';scope('all');renderSelection();$('feedback').textContent='Exemplo reiniciado.';});
let orbitVisible=false;const orbit=document.querySelector('.orbit');
const updateOrbit=()=>orbit.classList.toggle('visible',orbitVisible&&!document.hidden);
const observer=new IntersectionObserver(([entry])=>{orbitVisible=entry.isIntersecting;updateOrbit();});observer.observe(orbit);
document.addEventListener('visibilitychange',updateOrbit);
palette();renderSelection();renderList();
