export type Change = { kind: "same" | "add" | "remove"; text: string; before: number | null; after: number | null };
export type ExampleFile = { path: string; before: string; after: string };

/** Small LCS diff over bounded example text; never reads the workspace. */
export function linesDiff(before: string, after: string): Change[] {
  const left = before ? before.split("\n") : [], right = after ? after.split("\n") : [];
  const table = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--)
    table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const changes: Change[] = [];
  let i = 0, j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      changes.push({ kind: "same", text: left[i], before: ++i, after: ++j });
    } else if (i < left.length && (j === right.length || table[i + 1][j] >= table[i][j + 1])) {
      changes.push({ kind: "remove", text: left[i], before: ++i, after: null });
    } else {
      changes.push({ kind: "add", text: right[j], before: null, after: ++j });
    }
  }
  return changes;
}

export const files: ExampleFile[] = [
  { path: "src/app/page.tsx", before: 'import { Hero } from "./Hero";\n\nexport default function Home() {\n  return <main><Hero /></main>;\n}', after: 'import { Hero } from "./Hero";\nimport { FeatureList } from "./FeatureList";\n\nexport default function Home() {\n  return (\n    <main className="home">\n      <Hero />\n      <FeatureList />\n    </main>\n  );\n}' },
  { path: "docs/guia-rapido.md", before: '# Guia rápido\n\nAbra o projeto para começar.\n\n## Desenvolvimento\n\nExecute o servidor local.', after: '# Guia rápido\n\nAbra o projeto e escolha uma sessão.\n\n## Desenvolvimento\n\n1. Instale as dependências.\n2. Execute o servidor local.\n3. Revise as alterações antes de salvar.\n\n> Cada sessão mantém seu próprio espaço de trabalho.\n\n## Editor\n\nEdite **código ou Markdown** e use `⌘S` para salvar.' },
  { path: "src/app/home.css", before: '.home {\n  padding: 16px;\n}', after: '.home {\n  padding: 24px;\n  max-width: 960px;\n  margin-inline: auto;\n}' },
  { path: "src/app/FeatureList.tsx", before: "", after: 'const features = ["Sessões", "Revisão", "Worktrees"];\n\nexport function FeatureList() {\n  return <ul>{features.map(name => <li key={name}>{name}</li>)}</ul>;\n}' },
  { path: "src/lib/config.ts", before: 'export const compact = false;', after: 'export const compact = true;\nexport const showReview = true;' },
  { path: "docs/revisao.md", before: "", after: '# Revisão de alterações\n\nSelecione um arquivo para abrir o diff à direita.\n\n- Desfazer: somente os arquivos do turno.\n- Voltar à mensagem: arquivos e conversa.' },
];

export function counts(file: ExampleFile) {
  const changes = linesDiff(file.before, file.after);
  return { additions: changes.filter(line => line.kind === "add").length, deletions: changes.filter(line => line.kind === "remove").length };
}

export function pairedDiff(changes: Change[]): { left?: Change; right?: Change }[] {
  const pairs: { left?: Change; right?: Change }[] = [];
  for (let i = 0; i < changes.length;) {
    if (changes[i].kind === "same") { pairs.push({ left: changes[i], right: changes[i] }); i++; continue; }
    const removed: Change[] = [], added: Change[] = [];
    while (i < changes.length && changes[i].kind !== "same") { const line = changes[i++]; (line.kind === "remove" ? removed : added).push(line); }
    for (let j = 0; j < Math.max(removed.length, added.length); j++) pairs.push({ left: removed[j], right: added[j] });
  }
  return pairs;
}
