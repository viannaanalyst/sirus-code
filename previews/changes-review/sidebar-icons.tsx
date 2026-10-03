import { useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import "./sidebar-icons.css";

const libraries = [
  { id: "phosphor", name: "Phosphor", description: "Formas suaves e preenchimento bem definido.", source: "https://github.com/phosphor-icons/core" },
  { id: "tabler", name: "Tabler", description: "Contornos arredondados e desenho compacto.", source: "https://github.com/tabler/tabler-icons" },
  { id: "heroicons", name: "Heroicons", description: "Silhuetas sólidas e detalhes mais geométricos.", source: "https://github.com/tailwindlabs/heroicons" },
] as const;
type Library = typeof libraries[number]["id"];
const menus = [
  { id: "home", label: "Início" },
  { id: "kanban", label: "Kanban" },
  { id: "archived", label: "Arquivadas" },
  { id: "settings", label: "Configurações" },
] as const;
type Menu = typeof menus[number]["id"];
type Material = "solid" | "border" | "glass";
const materials: { id: Material; label: string }[] = [
  { id: "solid", label: "Sólido" }, { id: "border", label: "Borda suave" }, { id: "glass", label: "Vidro" },
];
const assets = import.meta.glob<string>("./sidebar-icon-assets/*/*.svg", { eager: true, query: "?url", import: "default" });

function Icon({ library, menu, filled = false }: { library: Library; menu: Menu; filled?: boolean }) {
  const url = assets[`./sidebar-icon-assets/${library}/${menu}-${filled ? "fill" : "outline"}.svg`];
  return <span className="library-icon" aria-hidden="true" style={{ "--icon-url": `url("${url}")` } as CSSProperties} />;
}

function Content({ menu }: { menu: Menu }) {
  if (menu === "home") return <><div className="project-row"><span className="folder-symbol" aria-hidden="true" />Switchyard <span>⌄</span></div><div className="thread-row active-thread">Ajustar a barra lateral</div><div className="thread-row">Leitor de documentos</div><div className="thread-row">Uma ideia nova</div><div className="project-row"><span className="folder-symbol" aria-hidden="true" />Meu próximo projeto <span>›</span></div><p className="workspace-note">Seus projetos e conversas,<br/>sempre por perto.</p></>;
  if (menu === "kanban") return <><div className="project-row">Switchyard</div><div className="mini-board">{["A fazer", "Em curso", "Concluído"].map((label, i) => <div key={label}><h4>{label}</h4><div className="task-card">{["Nova ideia", "Barra lateral", "Documentos"][i]}</div></div>)}</div><p className="workspace-note">Uma visão das sessões<br/>de cada projeto.</p></>;
  if (menu === "archived") return <><div className="project-row">Conversas arquivadas</div><div className="thread-row">Explorar o projeto</div><div className="thread-row">Primeiro protótipo</div><p className="workspace-note">As conversas guardadas<br/>continuam acessíveis.</p></>;
  return <><div className="project-row">Personalize o Switchyard</div>{["Geral", "Aparência", "Provedores", "Atalhos do teclado"].map(label => <div className="settings-row" key={label}>{label}<span>›</span></div>)}<p className="workspace-note">O menu da engrenagem<br/>abre as configurações.</p></>;
}

function Preview() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [material, setMaterial] = useState<Material>("solid");
  const [selected, setSelected] = useState<Library>("phosphor");
  const [menu, setMenu] = useState<Menu>("home");
  const [size, setSize] = useState<"compact" | "comfortable">("comfortable");
  const choice = libraries.find(library => library.id === selected)!;
  return <main className="icon-preview" data-theme={theme} data-material={material} data-size={size}>
    <div className="preview-shell">
      <header className="page-heading"><div><span className="eyebrow">SWITCHYARD / BARRA LATERAL</span><h1>Uma casa para os nossos menus.</h1><p>Casa preenchida, fundo arredondado e os ícones que fazem sentido no nosso app.</p></div><span className="preview-label">Prévia interativa</span></header>
      <div className="preview-controls">
        <div className="control-group"><span>Tema</span><div className="segmented" role="group" aria-label="Tema">{(["dark", "light"] as const).map(value => <button key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}>{value === "dark" ? "Escuro" : "Claro"}</button>)}</div></div>
        <div className="control-group"><span>Fundo do botão</span><div className="segmented" role="group" aria-label="Fundo do botão">{materials.map(value => <button key={value.id} aria-pressed={material === value.id} onClick={() => setMaterial(value.id)}>{value.label}</button>)}</div></div>
        <div className="control-group"><span>Tamanho</span><div className="segmented" role="group" aria-label="Tamanho dos ícones">{(["compact", "comfortable"] as const).map(value => <button key={value} aria-pressed={size === value} onClick={() => setSize(value)}>{value === "compact" ? "Atual · 14 px" : "Maior · 20 px"}</button>)}</div></div>
      </div>
      <section className="comparison-grid" aria-label="Comparação das bibliotecas">
        {libraries.map((library, index) => <article className="library-card" key={library.id} data-selected={library.id === selected}>
          <div className="card-heading"><span className="option-number">0{index + 1}</span><h2>{library.name}</h2>{library.id === "phosphor" && <span className="recommendation">Minha escolha</span>}</div>
          <div className="mock-window">
            <div className="mock-titlebar"><div className="traffic-lights" aria-hidden="true"><i/><i/><i/></div><span>Switchyard</span></div>
            <div className="mock-body">
              <nav className="mock-rail" aria-label={`Menus com ${library.name}`}>
                {menus.map(item => <button key={item.id} className="rail-button" aria-label={item.label} title={item.label} aria-current={menu === item.id ? "page" : undefined} onClick={() => { setMenu(item.id); setSelected(library.id); }}><Icon library={library.id} menu={item.id} filled={menu === item.id}/></button>)}
              </nav>
              <div className="mock-workspace"><div className="workspace-heading"><span>{menus.find(item => item.id === menu)!.label}</span><span className="workspace-plus" aria-hidden="true">+</span></div><Content menu={menu}/></div>
            </div>
          </div>
          <p className="library-description">{library.description}</p>
          <button className="choice-button" aria-pressed={selected === library.id} onClick={() => setSelected(library.id)}>{selected === library.id ? "Selecionado na prévia" : `Comparar ${library.name}`}</button>
        </article>)}
      </section>
      <section className="detail-section" aria-labelledby="detail-title">
        <div className="detail-copy"><span className="eyebrow">DETALHE DA OPÇÃO SELECIONADA</span><h2 id="detail-title">{choice.name}, nos dois temas.</h2><p>A casa fica branca no escuro e preta no claro. Clique nos menus acima para comparar os outros ícones.</p><div className="icon-key">{menus.map(item => <div key={item.id}><Icon library={selected} menu={item.id} filled={menu === item.id}/><span>{item.label}</span></div>)}</div></div>
        <div className="home-pair">{(["dark", "light"] as const).map(value => <div className="home-example" data-theme={value} key={value}><div className="home-button"><Icon library={selected} menu="home" filled/></div><span>{value === "dark" ? "Branco no escuro" : "Preto no claro"}</span></div>)}</div>
      </section>
      <footer className="preview-footer"><span>Ícones originais · licenças MIT</span><div>{libraries.map(library => <a key={library.id} href={library.source} target="_blank" rel="noreferrer">{library.name} ↗</a>)}</div></footer>
    </div>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Preview/>);
