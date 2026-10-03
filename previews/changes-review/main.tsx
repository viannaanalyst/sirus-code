import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowDown, ArrowLeft, Check, ChevronDown, ChevronUp, Columns2, FileCode2, FileDiff, FileText, PanelRight, RotateCcw, Undo2, Save, X } from "lucide-react";
import { CodeEditor, languageForPath } from "@/components/editor/CodeEditor";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Tooltip, TooltipProvider } from "@/primitives/Tooltip";
import { configureDynamicStyleNonce } from "@/lib/editor-nonce";
import "@/styles/index.css";
import "./preview.css";
import { counts, files, linesDiff, pairedDiff, type Change } from "./fixtures";

type Palette = "system" | "light" | "dark";
type Confirmation = "revert" | "discard" | null;
const options = ["01 · Lista compacta", "02 · Card de revisão", "03 · Linha discreta"];

function Tally({ additions, deletions }: { additions: number; deletions: number }) {
  return <span className="tally"><span className="added">+{additions}</span><span className="removed">−{deletions}</span></span>;
}
function Line({ line, side }: { line?: Change; side?: "left" | "right" }) {
  return <div className={`diff-line ${line?.kind ?? "empty"}`}><span className="number">{side === "left" ? line?.before : line?.after ?? line?.before}</span><span className="marker">{line?.kind === "add" ? "+" : line?.kind === "remove" ? "−" : " "}</span><code>{line?.text ?? " "}</code></div>;
}
function App() {
  const [variant, setVariant] = useState(0);
  const [palette, setPalette] = useState<Palette>("dark");
  const [glass, setGlass] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [more, setMore] = useState(false);
  const [selected, setSelected] = useState(0);
  const [panel, setPanel] = useState<"diff" | "editor" | null>(null);
  const [split, setSplit] = useState(true);
  const [mdPreview, setMdPreview] = useState(false);
  const [buffers, setBuffers] = useState(() => files.map(file => ({ content: file.after, saved: file.after })));
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [kept, setKept] = useState(false);
  const [reverted, setReverted] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const [prompt, setPrompt] = useState("");
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.theme = palette === "system" ? media.matches ? "dark" : "light" : palette; document.documentElement.dataset.popupGlass = glass ? "on" : "off"; };
    apply(); media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [palette, glass]);
  const total = files.reduce((sum, file) => { const count = counts(file); return { additions: sum.additions + count.additions, deletions: sum.deletions + count.deletions }; }, { additions: 0, deletions: 0 });
  const file = files[selected], buffer = buffers[selected], dirty = buffer.content !== buffer.saved;
  const changes = linesDiff(file.before, file.after);
  const openDiff = (index = selected) => { setSelected(index); setPanel("diff"); setMdPreview(false); };
  const save = () => { setBuffers(previous => previous.map((value, index) => index === selected ? { ...value, saved: value.content } : value)); setNotice("Exemplo salvo em memória."); };
  const reset = () => { setKept(false); setReverted(false); setRunning(false); setPrompt(""); setNotice(""); setPanel(null); setBuffers(files.map(value => ({ content: value.after, saved: value.after }))); };
  const confirm = () => {
    if (confirmation === "revert") { setReverted(true); setPanel(null); setPrompt("Melhore a página inicial e atualize o guia de desenvolvimento."); setBuffers(files.map(value => ({ content: value.before, saved: value.before }))); setNotice("Simulação: arquivos e conversa voltaram ao ponto anterior a esta mensagem."); }
    if (confirmation === "discard") { setBuffers(previous => previous.map((value, index) => index === selected ? { ...value, content: value.saved } : value)); setPanel(null); }
    setConfirmation(null);
  };
  return <div className={`preview ${glass ? "glass" : ""}`}>
    <header className="preview-controls"><div className="preview-title"><strong>Revisão de alterações</strong><span>Prévia interativa · dados de exemplo</span></div><div className="variants" role="group" aria-label="Opção de resumo">{options.map((option, index) => <button key={option} aria-pressed={variant === index} onClick={() => { setVariant(index); setExpanded(index !== 2); }}>{option}</button>)}</div><div className="palette" role="group" aria-label="Tema">{(["system", "light", "dark"] as const).map((value, index) => <button key={value} aria-pressed={palette === value} onClick={() => setPalette(value)}>{["Sistema", "Claro", "Escuro"][index]}</button>)}<label><input type="checkbox" checked={glass} onChange={event => setGlass(event.target.checked)} /> Translúcido</label></div></header>
    <div className={`workspace ${panel ? "with-panel" : ""}`}>
      <main className="conversation"><div className="conversation-top"><span className="orbital" aria-hidden="true">◉</span><strong>Switchyard</strong><span>Revisão da página inicial</span><button title="Abrir revisão à direita" aria-label="Abrir revisão à direita" onClick={() => openDiff()}><PanelRight size={17}/></button></div>
        <div className="timeline">{!reverted && <div className="sent-message"><div className="user-message">Melhore a página inicial e atualize o guia de desenvolvimento.</div><div className="user-actions"><span>Hoje, 14:32</span><Tooltip label="Voltar a esta mensagem"><button className="icon-button" aria-label="Voltar a esta mensagem" onClick={() => setConfirmation("revert")} disabled={running}><Undo2 size={16} strokeWidth={1.6}/></button></Tooltip></div></div>}
          {!reverted && <><div className="model-line"><span className={`orbital ${running ? "working" : ""}`} aria-hidden="true">◉</span><strong>GPT-6.1-Sol</strong><span>{running ? "Trabalhando há 12s" : "Trabalhou por 2m 47s"}</span><ChevronDown size={15}/></div><p>Atualizei a página inicial com uma lista de funcionalidades e melhorei o guia de desenvolvimento.</p><p className="muted">Os arquivos estão prontos para revisão. Você pode conferir cada alteração no painel direito.</p>
          {!running && <section className={`change-summary variant-${variant}`} aria-label="Resumo de alterações do turno"><div className="summary-header"><FileDiff size={19}/><button className="summary-toggle" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}><strong>{`${files.length} arquivos alterados`}</strong><Tally {...total}/></button><div className="summary-actions"><button onClick={() => { setKept(true); setNotice("Simulação: alterações mantidas. O histórico de revisão continua disponível."); }} disabled={kept}>{kept ? <><Check size={13}/>Mantidas</> : "Manter"}</button><button className="review-button" onClick={() => openDiff()}>Revisar</button><button className="icon-button" aria-label={expanded ? "Recolher arquivos" : "Expandir arquivos"} onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}</button></div></div>
          {expanded && <div className="file-rows">{(more ? files : files.slice(0, 5)).map((value, index) => <button className="file-row" key={value.path} onClick={() => openDiff(index)}>{value.path.endsWith(".md") ? <FileText size={16}/> : <FileCode2 size={16}/>}<span>{value.path}</span><Tally {...counts(value)}/><ChevronDown size={14}/></button>)}<button className="more-files" onClick={() => setMore(value => !value)}>{more ? <ChevronUp size={14}/> : <ChevronDown size={14}/>} {more ? "Mostrar menos" : `Mostrar mais ${files.length - 5} arquivo`}</button></div>}</section>}
          <div className="assistant-actions"><span>Hoje, 14:35</span><span>·</span><span>{running ? "Em execução" : "Concluído"}</span></div></>}
          {reverted && <div className="reverted-state"><RotateCcw size={20}/><strong>Conversa restaurada nesta prévia</strong><p>A mensagem voltou ao campo de escrita. Os turnos posteriores foram removidos da simulação.</p></div>}
          {notice && <p className="notice" role="status">{notice}</p>}
        </div><div className="composer"><textarea aria-label="Mensagem de exemplo" placeholder="Escreva uma mensagem…" value={prompt} onChange={event => setPrompt(event.target.value)}/><div><span>Somente simulação · sem acesso ao projeto</span><button className="icon-button" aria-label="Simular envio" disabled={!prompt.trim()} onClick={() => { setNotice("Envio apenas demonstrativo. Nenhum modelo foi chamado."); setPrompt(""); }}><ArrowDown size={15}/></button></div></div><div className="scenario-controls"><button onClick={() => { setRunning(value => !value); setNotice(""); }} disabled={reverted}>{running ? "Simular conclusão" : "Simular em execução"}</button><button onClick={reset}>Reiniciar exemplo</button><button onClick={() => { setSelected(1); setPanel("editor"); setMdPreview(false); }}>Testar editor Markdown</button></div>
      </main>
      {panel && <aside className="review-panel"><div className="panel-header"><FileDiff size={17}/><strong>{panel === "diff" ? "Alterações do turno" : "Editor"}</strong><span className="sample-badge">Exemplo</span><button className="icon-button" title="Fechar painel" aria-label="Fechar painel" onClick={() => { if (panel === "editor" && dirty) setConfirmation("discard"); else setPanel(null); }}><X size={16}/></button></div><div className="panel-tools">{panel === "diff" ? <><span>Turno 01</span><Tally {...total}/><button className="mode-button" aria-pressed={split} onClick={() => setSplit(value => !value)}><Columns2 size={14}/>{split ? "Lado a lado" : "Unificado"}</button><button onClick={() => setPanel("editor")}>Editar exemplo</button></> : <><button onClick={() => setPanel("diff")}><ArrowLeft size={14}/>Diff</button><span>{dirty ? "Não salvo" : "Salvo em memória"}</span>{file.path.endsWith(".md") && <button aria-pressed={mdPreview} onClick={() => setMdPreview(value => !value)}>{mdPreview ? "Código" : "Prévia"}</button>}<button className="review-button" disabled={!dirty} onClick={save}><Save size={13}/>Salvar <kbd>⌘S</kbd></button></>}</div><nav className="file-tabs" aria-label="Arquivos de exemplo">{files.map((value, index) => <button key={value.path} aria-pressed={selected === index} onClick={() => { setSelected(index); setMdPreview(false); }}>{value.path.split("/").at(-1)}</button>)}</nav><div className="file-heading"><FileCode2 size={15}/><span>{file.path}</span><Tally {...counts(file)}/></div>
      {panel === "diff" ? <div className="diff-scroller">{split ? <><div className="split-labels"><span>Antes</span><span>Depois</span></div><div className="split-diff">{pairedDiff(changes).map((pair, index) => <div className="diff-pair" key={index}><Line line={pair.left} side="left"/><Line line={pair.right} side="right"/></div>)}</div></> : <div className="unified-diff">{changes.map((line, index) => <Line key={index} line={line}/>)}</div>}<p className="diff-help">Diff histórico do exemplo · selecione outro arquivo para revisar</p></div> : <div className="editor-area">{mdPreview ? <MarkdownPreview source={buffer.content}/> : <CodeEditor key={file.path} label={`Editar exemplo ${file.path}`} language={languageForPath(file.path)} value={buffer.content} onChange={content => setBuffers(previous => previous.map((value, index) => index === selected ? { ...value, content } : value))} onSave={save}/>}</div>}
      <div className="panel-footer"><span>{panel === "editor" ? "Texto editável · Tab indenta · Escape, Tab sai do editor" : "Clique em Revisar ou em qualquer arquivo no resumo."}</span></div></aside>}
    </div>
    <Dialog open={confirmation !== null} onOpenChange={open => { if (!open) setConfirmation(null); }}><DialogContent title={confirmation === "revert" ? "Voltar a esta mensagem?" : "Descartar alterações do exemplo?"} description={confirmation === "revert" ? "Os arquivos e a conversa voltam ao estado anterior a esta mensagem. As mensagens e alterações dos turnos seguintes são removidas." : "O texto não salvo deste arquivo será descartado."} className="w-[min(460px,calc(100vw-32px))]"><p className="confirmation-note">Simulação: nenhum arquivo real ou conversa de provedor será modificado.</p><div className="confirmation-actions"><button onClick={() => setConfirmation(null)}>Cancelar</button><button className="danger-button" onClick={confirm}>{confirmation === "revert" ? "Voltar à mensagem" : "Descartar"}</button></div></DialogContent></Dialog>
  </div>;
}
configureDynamicStyleNonce(document);
createRoot(document.getElementById("root")!).render(<TooltipProvider><App/></TooltipProvider>);
