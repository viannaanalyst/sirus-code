import "../../src/styles/index.css";
import "./preview.css";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { Archive, ArchiveRestore, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, CircleUser, Columns3, Folder, FolderOpen, GitBranch, GitCompareArrows, Inbox, MessageCircle, Mic, PanelLeft, Pin, PinOff, Plus, RotateCcw, Search, Settings, SquarePen, Terminal, Workflow, X, Zap } from "lucide-react";
import { Tooltip } from "../../src/primitives/Tooltip";
import { motionTokens } from "../../src/lib/motion";
import openai from "../../src/assets/models/openai.svg?inline";
import claude from "../../src/assets/providers/claude.svg?inline";
import deepseek from "../../src/assets/models/deepseek.svg?inline";

const studies = [
  { id: "silver", name: "Prata essencial", note: "Pastas de traço fino, linhas leves e ações que aparecem só quando você precisa." },
  { id: "fold", name: "Dobras de metal", note: "Pastas com profundidade em prata acetinada. Uma sidebar um pouco mais tátil, sem perder a calma." },
  { id: "orbit", name: "Órbita", note: "Um detalhe orbital na pasta e um reflexo suave na sessão ativa. A identidade do Sirus Code em escala pequena." },
  { id: "rails", name: "Trilhos", note: "Pastas azuladas e uma linha discreta conectando as sessões. A hierarquia fica mais fácil de percorrer." },
  { id: "layers", name: "Camadas", note: "Pastas translúcidas e projetos em grupos suaves. Mais separação visual para quem trabalha com vários projetos." },
] as const;
type Variant = typeof studies[number]["id"];
type Project = { id: string; name: string; path: string; pinned: boolean; expanded: boolean };
type Session = { id: string; project: string; title: string; brand: "openai" | "claude" | "deepseek"; model: string; effort: string; branch: string; pinned: boolean; archived: boolean; isolated: boolean; time: string; running?: boolean; handoff?: boolean };
type Card = { kind: "project" | "session"; id: string; x: number; y: number };
const initialProjects: Project[] = [
  { id: "sy", name: "sirus", path: "~/Projetos/sirus-code", pinned: false, expanded: true },
  { id: "pa", name: "peticionaaqui", path: "~/Projetos/peticionaaqui", pinned: false, expanded: true },
  { id: "ic", name: "inchurch-contrato", path: "~/Projetos/inchurch-contrato", pinned: false, expanded: false },
];
const initialSessions: Session[] = [
  { id: "s1", project: "sy", title: "Refinar o composer e o ditado", brand: "openai", model: "GPT-6 Luna", effort: "Extra alto", branch: "main", pinned: true, archived: false, isolated: false, time: "agora" },
  { id: "s2", project: "sy", title: "Uma nova sidebar para o Sirus Code", brand: "claude", model: "Opus 5", effort: "Alto", branch: "sirus/sidebar", pinned: false, archived: false, isolated: true, time: "12 min", running: true },
  { id: "s3", project: "sy", title: "Revisar os ícones dos modelos", brand: "deepseek", model: "DeepSeek V4.1 Flash", effort: "Máximo", branch: "main", pinned: false, archived: false, isolated: false, time: "1 h", handoff: true },
  { id: "s4", project: "pa", title: "Analisar a estrutura do projeto", brand: "openai", model: "GPT-6 Luna", effort: "Alto", branch: "main", pinned: false, archived: false, isolated: false, time: "2 h" },
  { id: "s5", project: "pa", title: "Ajustar a página de documentos", brand: "claude", model: "Opus 5", effort: "Alto", branch: "sirus/documentos", pinned: false, archived: false, isolated: true, time: "3 h" },
  { id: "s6", project: "ic", title: "Implementações no contrato", brand: "deepseek", model: "DeepSeek V4.1 Flash", effort: "Alto", branch: "main", pinned: false, archived: false, isolated: false, time: "ontem" },
];
const brands = { openai, claude, deepseek };
function Brand({ brand, handoff = false }: { brand: Session["brand"]; handoff?: boolean }) {
  return <span className="brand-icon"><img src={brands[brand]} alt="" />{handoff && <span className="handoff-mark" aria-label="Sessão com handoff"><GitCompareArrows /></span>}</span>;
}
function FolderGlyph({ open = true }: { open?: boolean }) {
  const silverId = useId();
  return <span className="folder-glyph" aria-hidden="true" style={{ "--folder-fill": `url(#${silverId})` } as CSSProperties}><svg className="folder-material" viewBox="0 0 28 24"><defs><linearGradient id={silverId} x1="0" y1="0" x2=".7" y2="1"><stop stopColor="currentColor" stopOpacity=".95" /><stop offset=".28" stopColor="currentColor" stopOpacity=".65" /><stop offset=".57" stopColor="currentColor" stopOpacity=".35" /><stop offset="1" stopColor="currentColor" stopOpacity=".85" /></linearGradient></defs><path className="folder-back" d="M3 5.5C3 4.1 4.1 3 5.5 3h6l2.5 3h8.5C23.9 6 25 7.1 25 8.5V19H3Z" /><path className="folder-front" d="M2.5 10.5c0-1.1.9-2 2-2h19c1.3 0 2.3 1.2 2 2.5l-2 8c-.2.9-1 1.5-2 1.5h-16c-1 0-1.8-.7-2-1.7Z" /><path className="folder-lip" d="M5 11h18" /><ellipse className="folder-orbit" cx="14" cy="12" rx="13" ry="5" transform="rotate(-25 14 12)" /><circle className="folder-satellite" cx="24" cy="5.7" r="1.5" /></svg><span className="folder-outline">{open ? <FolderOpen /> : <Folder />}</span></span>;
}
function Action({ label, children, onClick, pressed, className = "" }: { label: string; children: ReactNode; onClick: () => void; pressed?: boolean; className?: string }) {
  return <Tooltip label={label}><button type="button" className={`icon-action ${className}`} aria-label={label} aria-pressed={pressed} onClick={event => { event.stopPropagation(); onClick(); }}>{children}</button></Tooltip>;
}
function App() {
  const requested = new URL(location.href).searchParams.get("style") ?? document.body.dataset.variant;
  const [variant, setVariant] = useState<Variant>(studies.find(row => row.id === requested)?.id ?? "silver");
  const [projects, setProjects] = useState(() => initialProjects.map(row => ({ ...row })));
  const [sessions, setSessions] = useState(() => initialSessions.map(row => ({ ...row })));
  const [selected, setSelected] = useState("s2");
  const [card, setCard] = useState<Card | null>(null);
  const [archivedView, setArchivedView] = useState(false);
  const [filter, setFilter] = useState("");
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState("Passe o mouse sobre uma pasta ou sessão para experimentar.");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [draft, setDraft] = useState("");
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = sessions.find(row => row.id === selected) ?? sessions[0];
  const activeProject = projects.find(row => row.id === active?.project);
  const study = studies.find(row => row.id === variant)!;
  useEffect(() => { document.body.dataset.variant = variant; return () => { if (closeTimer.current) clearTimeout(closeTimer.current); }; }, [variant]);
  function holdCard() { if (closeTimer.current) clearTimeout(closeTimer.current); }
  function dismissCard() { holdCard(); closeTimer.current = setTimeout(() => setCard(null), motionTokens.fast * 1000); }
  function showCard(kind: Card["kind"], id: string, element: HTMLElement) {
    holdCard();
    const bounds = element.getBoundingClientRect();
    const width = Math.min(304, window.innerWidth - 24);
    setCard({ kind, id, x: Math.min(bounds.right + 8, window.innerWidth - width - 12), y: Math.max(12, Math.min(bounds.top, window.innerHeight - 230)) });
  }
  function pinSession(id: string) {
    setSessions(rows => rows.map(row => row.id === id ? { ...row, pinned: !row.pinned } : row));
    const row = sessions.find(row => row.id === id)!;
    setNotice(row.pinned ? "Sessão devolvida ao projeto." : "Sessão movida para Fixadas."); setCard(null);
  }
  function pinProject(id: string) {
    setProjects(rows => rows.map(row => row.id === id ? { ...row, pinned: !row.pinned } : row));
    const row = projects.find(row => row.id === id)!;
    setNotice(row.pinned ? "Projeto desafixado." : "Projeto fixado no início de Projetos."); setCard(null);
  }
  function archive(id: string) {
    setSessions(rows => rows.map(row => row.id === id ? { ...row, archived: !row.archived, pinned: false } : row));
    setNotice(sessions.find(row => row.id === id)?.archived ? "Sessão restaurada ao projeto." : "Sessão arquivada. Você pode restaurá-la em Arquivadas."); setCard(null);
  }
  function reset() { setProjects(initialProjects.map(row => ({ ...row }))); setSessions(initialSessions.map(row => ({ ...row }))); setSelected("s2"); setCard(null); setArchivedView(false); setFilter(""); setNotice("Demonstração restaurada."); }
  const matches = (row: Session) => row.title.toLocaleLowerCase("pt-BR").includes(filter.toLocaleLowerCase("pt-BR"));
  function sessionRow(row: Session, pinnedArea = false) {
    return <div key={row.id} className={`session-row ${row.id === selected ? "selected" : ""} ${pinnedArea ? "pinned-row" : ""}`} onMouseEnter={event => showCard("session", row.id, event.currentTarget)} onMouseLeave={dismissCard} onFocus={event => showCard("session", row.id, event.currentTarget)} onBlur={dismissCard}>
      <button type="button" className="session-open ui-control" aria-current={row.id === selected ? "page" : undefined} onClick={() => { setSelected(row.id); setCard(null); }}><Brand brand={row.brand} handoff={row.handoff} /><span className="row-title">{row.title}</span>{pinnedArea && <span className="project-hint ui-micro">{projects.find(item => item.id === row.project)?.name}</span>}<span className="row-meta">{row.isolated ? <GitBranch className="worktree-status" aria-label="Worktree isolado" /> : row.running ? <span className="status-dot" aria-label="Em execução" /> : <span className="ui-micro">{row.time}</span>}</span></button>
      <span className="row-actions session-actions"><Action label={row.pinned ? "Desafixar sessão" : "Fixar sessão"} pressed={row.pinned} onClick={() => pinSession(row.id)}>{row.pinned ? <PinOff /> : <Pin />}</Action><Action label={row.archived ? "Restaurar sessão" : "Arquivar sessão"} onClick={() => archive(row.id)}>{row.archived ? <ArchiveRestore /> : <Archive />}</Action></span>
    </div>;
  }
  const popupProject = card?.kind === "project" ? projects.find(row => row.id === card.id) : undefined;
  const popupSession = card?.kind === "session" ? sessions.find(row => row.id === card.id) : undefined;
  return <>
    <header className="preview-header"><a className="ui-brand" href="./"><img src="/sirus-glyph.png" alt="" />Sirus Code <span className="ui-caption">/ sidebar</span></a><button type="button" className="reset-button ui-control" onClick={reset}><RotateCcw />Reiniciar preview</button></header>
    <main className="preview-main">
      <div className="preview-intro"><p className="ui-caption eyebrow">CINCO ESTUDOS / NAVEGAÇÃO</p><h1 className="ui-title">Seus projetos. Cada sessão no seu lugar.</h1><p className="ui-body">Pastas, pins e detalhes no hover — com o acabamento do Sirus Code.</p></div>
      <div className="study-tabs" role="tablist" aria-label="Estilo da sidebar">{studies.map((row, index) => <button type="button" key={row.id} id={`tab-${row.id}`} role="tab" aria-selected={row.id === variant} aria-controls="preview-panel" tabIndex={row.id === variant ? 0 : -1} onClick={() => { setVariant(row.id); setCard(null); const url = new URL(location.href); url.searchParams.set("style", row.id); history.replaceState(null, "", url); }} onKeyDown={event => { const movement = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0; if (!movement && event.key !== "Home" && event.key !== "End") return; event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? studies.length - 1 : (index + movement + studies.length) % studies.length; setVariant(studies[next].id); setCard(null); document.getElementById(`tab-${studies[next].id}`)?.focus(); }}><span className="ui-micro">0{index + 1}</span>{row.name}</button>)}</div>
      <section className="preview-window" id="preview-panel" role="tabpanel" aria-labelledby={`tab-${variant}`} onKeyDown={event => { if (event.key === "Escape") { setCard(null); setEditing(null); } }}>
        <div className="window-titlebar"><span className="traffic-lights" aria-hidden="true"><i /><i /><i /></span><span className="window-context ui-caption"><PanelLeft /><ChevronLeft /><ChevronRight />{activeProject?.name}</span><span className="ui-micro window-label">PREVIEW INTERATIVO</span></div>
        <div className="window-body">
          <aside className="sidebar" aria-label="Sidebar de demonstração">
            <div className="sidebar-brand"><span className="ui-brand">Sirus Code</span><Action label="Buscar sessões" onClick={() => { setSearching(value => !value); setFilter(""); }}><Search /></Action></div>
            <nav className="sidebar-nav" aria-label="Navegação"><button className="nav-row ui-control" onClick={() => setNotice("Nova sessão no projeto selecionado — ação simulada.")}><SquarePen />Nova sessão<span className="ui-micro">⌘N</span></button><button className="nav-row ui-control" onClick={() => setNotice("Abrir Kanban — ação simulada.")}><Columns3 />Kanban</button><button className="nav-row ui-control" onClick={() => setArchivedView(value => !value)} aria-pressed={archivedView}><Archive />Arquivadas<span className="ui-micro">{sessions.filter(row => row.archived).length || ""}</span></button><button className="nav-row ui-control subdued" onClick={() => setNotice("Caixa de entrada — apenas demonstração visual.")}><Inbox />Caixa de entrada</button><button className="nav-row ui-control subdued" onClick={() => setNotice("Automações — apenas demonstração visual.")}><Workflow />Automações</button></nav>
            {searching && <label className="sidebar-search"><Search /><input autoFocus value={filter} onChange={event => setFilter(event.target.value)} className="ui-control" placeholder="Buscar sessões…" aria-label="Buscar sessões" /><Action label="Fechar busca" onClick={() => { setSearching(false); setFilter(""); }}><X /></Action></label>}
            <div className="sidebar-scroll">
              {archivedView ? <><div className="section-caption ui-caption">Arquivadas</div>{sessions.filter(row => row.archived && matches(row)).map(row => sessionRow(row, true))}{!sessions.some(row => row.archived) && <p className="empty-state ui-caption">Nenhuma sessão arquivada.</p>}</> : <>
                {sessions.some(row => row.pinned && !row.archived) && <section className="pinned-section"><div className="section-caption ui-caption">Fixadas<span><Pin /></span></div>{sessions.filter(row => row.pinned && !row.archived && matches(row)).map(row => sessionRow(row, true))}</section>}
                <div className="section-caption ui-caption">Projetos<Action label="Adicionar projeto" onClick={() => setNotice("Abrir seletor de pasta — ação simulada.")}><Plus /></Action></div>
                {[...projects].sort((a, b) => Number(b.pinned) - Number(a.pinned)).map(project => <section className="project-group" key={project.id}>
                  <div className={`project-row ${project.pinned ? "project-pinned" : ""}`} onMouseEnter={event => showCard("project", project.id, event.currentTarget)} onMouseLeave={dismissCard} onFocus={event => showCard("project", project.id, event.currentTarget)} onBlur={dismissCard}>
                    <button className="project-open ui-control" aria-expanded={project.expanded} onClick={() => { setProjects(rows => rows.map(row => row.id === project.id ? { ...row, expanded: !row.expanded } : row)); setCard(null); }}><FolderGlyph open={project.expanded} /><span className="row-title">{project.name}</span><ChevronDown className="disclosure" /></button>
                    <Action label={project.pinned ? "Desafixar projeto" : "Fixar projeto"} pressed={project.pinned} className="project-pin" onClick={() => pinProject(project.id)}>{project.pinned ? <Pin fill="currentColor" /> : <Pin />}</Action>
                    <span className="row-actions project-actions"><Action label="Revisão de código" onClick={() => setNotice(`Abrir revisão de código em ${project.name} — ação simulada.`)}><GitCompareArrows /></Action><Action label="Nova sessão de terminal" onClick={() => setNotice(`Criar sessão de terminal em ${project.name} — ação simulada.`)}><Terminal /></Action><Action label="Nova sessão" onClick={() => setNotice(`Criar sessão em ${project.name} — ação simulada.`)}><SquarePen /></Action></span>
                  </div>
                  {project.expanded && <div className="nested-sessions">{sessions.filter(row => row.project === project.id && !row.pinned && !row.archived && matches(row)).map(row => sessionRow(row))}{!sessions.some(row => row.project === project.id && !row.pinned && !row.archived) && <p className="empty-state ui-caption">Suas sessões aparecem aqui.</p>}</div>}
                </section>)}
              </>}
            </div>
            <div className="sidebar-footer ui-caption"><CircleUser />Workspace local<Action label="Configurações" onClick={() => setNotice("Abrir configurações — ação simulada.")}><Settings /></Action></div>
          </aside>
          <div className="session-stage"><div className="session-heading ui-control"><Brand brand={active.brand} /><span>{active.title}</span><span className="stage-status ui-caption">{active.archived ? "Arquivada" : active.running ? "Em execução" : "Concluída"}</span></div>
            <div className="chat-content"><div className="user-bubble ui-chat">Vamos deixar a navegação mais bonita e fácil de usar.</div><div className="agent-message ui-chat"><Brand brand={active.brand} /><div><p>Os projetos organizam seu trabalho.</p><p className="text-text-secondary">Fixe as sessões que você quer ter sempre por perto. Os detalhes e as ações aparecem ao passar o mouse.</p><div className="change-preview ui-caption"><span><Check />Sidebar e organização</span><span><FolderOpen />Pastas · sessões · fixadas</span></div></div></div></div>
            <div className="stage-composer"><div className="workspace-caption ui-caption"><Folder />{activeProject?.name}<span>·</span><GitBranch />{active.branch}</div><div className="composer"><textarea value={draft} onChange={event => setDraft(event.target.value)} className="ui-chat" aria-label="Mensagem simulada" placeholder="Pergunte algo ou dite sua ideia…" /><div className="composer-bottom"><button aria-label="Adicionar anexo simulado" onClick={() => setNotice("Adicionar anexo — ação simulada.")}><Plus /></button><span className="ui-control"><Brand brand={active.brand} />{active.model}<ChevronDown /></span><button aria-label="Ditar simulado" onClick={() => setNotice("Preview visual: o microfone não é acessado.")}><Mic /></button><button className="send" aria-label="Enviar simulado" disabled={!draft.trim()} onClick={() => { setDraft(""); setNotice("Envio simulado. Nenhum provedor foi acionado."); }}><ArrowUp /></button></div></div></div>
          </div>
        </div>
      </section>
      <div className="preview-description"><div><p className="ui-caption eyebrow">0{studies.indexOf(study) + 1} / {study.name.toUpperCase()}</p><p className="ui-body">{study.note}</p></div><span className="ui-caption">Hover · fixar · arquivar · expandir</span></div>
      <p className="preview-status ui-caption" role="status">{notice}</p><p className="preview-note ui-micro">Demonstração local com dados de exemplo. Nenhum arquivo, sessão ou configuração do app é alterado.</p>
    </main>
    {card && createPortal(<div className={`hover-card ${variant}`} role="dialog" aria-label={popupProject ? `Detalhes de ${popupProject.name}` : `Detalhes de ${popupSession?.title}`} style={{ left: card.x, top: card.y }} onMouseEnter={holdCard} onMouseLeave={dismissCard} onFocus={holdCard} onBlur={dismissCard} onKeyDown={event => { if (event.key === "Escape") setCard(null); }}>
      {popupProject && <><div className="card-line card-title ui-control"><FolderGlyph /><strong>{popupProject.name}</strong><Action label={popupProject.pinned ? "Desafixar projeto" : "Fixar projeto"} onClick={() => pinProject(popupProject.id)} pressed={popupProject.pinned}><Pin fill={popupProject.pinned ? "currentColor" : "none"} /></Action></div><div className="card-line ui-control"><MessageCircle />{sessions.filter(row => row.project === popupProject.id && !row.archived).length} sessões</div><div className="card-divider" /><div className="card-line ui-caption"><Folder /><span>{popupProject.path}</span></div><div className="card-divider" /><button className="card-line card-edit ui-control" onClick={() => { setEditing(popupProject.id); setEditName(popupProject.name); setCard(null); }}><Settings />Editar projeto</button></>}
      {popupSession && <><div className="card-title card-line ui-control"><strong>{popupSession.title}</strong><span className="ui-micro">{popupSession.time}</span></div><div className="card-line ui-control"><Folder />{projects.find(row => row.id === popupSession.project)?.name}</div><div className="card-line ui-control"><GitBranch /><span>{popupSession.branch}</span></div>{popupSession.isolated && <div className="card-line ui-caption"><GitCompareArrows />Worktree isolado</div>}<div className="card-line card-model ui-control"><Brand brand={popupSession.brand} /><span>{popupSession.model}</span><Zap /><span className="ui-caption">{popupSession.effort}</span></div>{popupSession.running && <div className="card-line ui-caption"><span className="status-dot" />Em execução</div>}</>}
    </div>, document.body)}
    <Dialog.Root open={Boolean(editing)} onOpenChange={open => { if (!open) setEditing(null); }}><Dialog.Portal><Dialog.Overlay className="edit-overlay" /><Dialog.Content className="edit-dialog"><form onSubmit={event => { event.preventDefault(); if (!editName.trim()) return; setProjects(rows => rows.map(row => row.id === editing ? { ...row, name: editName.trim() } : row)); setEditing(null); setNotice("Nome atualizado apenas neste preview."); }}><Dialog.Title className="ui-dialog-title">Editar projeto</Dialog.Title><Dialog.Description className="ui-caption text-text-muted">Apenas o nome de exemplo deste preview será alterado.</Dialog.Description><label className="ui-control">Nome<input autoFocus className="ui-control" value={editName} onChange={event => setEditName(event.target.value)} required maxLength={80} /></label><div><button type="button" className="ui-control" onClick={() => setEditing(null)}>Cancelar</button><button type="submit" className="ui-control">Salvar</button></div></form></Dialog.Content></Dialog.Portal></Dialog.Root>
  </>;
}
createRoot(document.getElementById("root")!).render(<App />);
