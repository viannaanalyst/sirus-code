import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FileTree } from "@/components/FileTree";
import { ChangesPane } from "@/components/ChangesPane";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { TooltipProvider } from "@/primitives/Tooltip";
import { applyAppearance, mergeSettings } from "@/lib/settings";
import { configureDynamicStyleNonce } from "@/lib/editor-nonce";
import { fixtureRoot, fixtureSessionId, previewFile, resetPreviewFiles } from "./workspace-tools-files";
import { previewGit, resetPreviewGit } from "./workspace-tools-git";
import "./workspace-tools.css";

function setPalette(theme: "dark" | "light") {
  applyAppearance(mergeSettings({ theme, animations: false, reduceMotion: true }), { translucency: false, dockIcon: false });
}
setPalette("dark");
configureDynamicStyleNonce(document);

function Preview() {
  const [pane, setPane] = useState<"files" | "changes">("files");
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const content = selected ? previewFile(selected) : undefined;
  return <TooltipProvider>
    <div className="workspace-preview">
      <header className="space-y-3">
        <h1 className="ui-title text-text-primary">Explorer e Changes</h1>
        <p className="ui-description text-text-secondary">Prévia interativa com dados simulados. Nenhum provedor é chamado, nenhum arquivo real é criado e nenhum commit ou Push é enviado.</p>
        <div className="flex flex-wrap gap-2">
          <InteractiveButton variant="secondary" onClick={() => setPalette("dark")}>Escuro</InteractiveButton>
          <InteractiveButton variant="secondary" onClick={() => setPalette("light")}>Claro</InteractiveButton>
          <InteractiveButton variant="ghost" onClick={() => { resetPreviewFiles(); resetPreviewGit(); setSelected(null); setRevision(value => value + 1); }}>Recomeçar exemplo</InteractiveButton>
        </div>
      </header>
      <div className="workspace-preview-grid">
        <section className="workspace-preview-editor">
          <h2 className="ui-section-title text-text-primary">Projeto de exemplo</h2>
          <p className="mt-3 ui-description text-text-secondary">No Explorer, selecione uma pasta e use os botões acima da árvore para criar um arquivo ou uma pasta.</p>
          <p className="mt-3 ui-description text-text-secondary">Em Changes, prepare os arquivos com +, gere um título simulado e faça o commit. Você pode cancelar ou editar durante a geração. Novas gerações alternam Codex/completo e Claude/parcial simulados. O Push tem confirmação.</p>
          <div className="mt-6 rounded-lg border border-border-subtle bg-background-0 p-3">
            <h3 className="truncate ui-control text-text-primary">{selected?.replace("/preview/switchyard/", "") ?? "Selecione um arquivo"}</h3>
            <pre className="mt-3 overflow-auto whitespace-pre-wrap font-mono ui-control text-text-secondary">{content === undefined || content === null ? "O conteúdo do arquivo selecionado aparecerá aqui." : content || "Arquivo vazio — pronto para editar no aplicativo."}</pre>
          </div>
        </section>
        <div className="workspace-preview-pane">
          <nav aria-label="Painel do workspace">
            <InteractiveButton variant={pane === "files" ? "secondary" : "ghost"} aria-pressed={pane === "files"} onClick={() => setPane("files")}>Explorer</InteractiveButton>
            <InteractiveButton variant={pane === "changes" ? "secondary" : "ghost"} aria-pressed={pane === "changes"} onClick={() => setPane("changes")}>Changes</InteractiveButton>
          </nav>
          <section key={`${pane}:${revision}`} aria-label={pane === "files" ? "Explorer de exemplo" : "Changes de exemplo"}>
            {pane === "files" ? <FileTree sessionId={fixtureSessionId} rootLabel="switchyard" onOpenFile={setSelected} /> : <ChangesPane sessionId={fixtureSessionId} workspacePath={fixtureRoot} api={previewGit} />}
          </section>
        </div>
      </div>
    </div>
  </TooltipProvider>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
