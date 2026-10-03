# Switchyard

Aplicativo desktop local-first para desenvolvimento assistido por agentes de IA.

Projeto → Sessões → Agentes → Git Worktrees → revisão de alterações.

## Requisitos

- Node.js 22.18+
- Rust (stable)
- Git
- macOS recomendado para esta V1
- Uma CLI instalada (Codex, Claude Code, OpenCode ou Cursor compatível com Auto-review) para executar agentes. O catálogo e formato do Grok foram verificados; execução exige login na própria CLI e permanece sem validação autenticada neste ambiente.

## Desenvolvimento

```bash
npm install
npm run tauri dev
```

O frontend Vite sobe em `http://localhost:1420`. Use o comando Tauri acima — o webview é o ambiente real.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run test:arc
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Uso inicial

1. Abra o Switchyard.
2. Adicione uma pasta Git local (Projects → Open).
3. Crie uma sessão (⌘N).
4. Escolha um modelo/provedor e checkout atual ou worktree isolado.
5. Envie uma instrução.
6. Acompanhe o output, o Git status, o diff e o terminal da sessão.

Remover um projeto da lista **não** apaga arquivos no disco.

O Kanban da barra lateral organiza as sessões do projeto por estado real de execução. As colunas acompanham os eventos dos agentes; clicar em um cartão abre a sessão. O quadro não altera estados manualmente.

O rodapé das respostas permite copiar, continuar em uma nova sessão (garfo) e fixar mensagens. As fixadas ficam no painel de contexto. O garfo importa o histórico até a resposta, preserva a conta/modelo e oferece um link à origem; aguarda um novo envio. Em Git, cria um worktree no commit atual da origem, sem copiar alterações não commitadas. É uma continuação pelo histórico (até 32 KiB), sem clonar o estado interno da CLI.

A faixa abaixo do composer mostra o Terminal e o uso real de Codex, Claude Code, Cursor e OpenCode Go, com renovação da cota, atualização manual e seleção de vários provedores. O popup identifica a conta consultada; Go identifica a chave conectada porque seu endpoint não retorna email. Codex e Claude permitem adicionar contas em perfis separados pelo login oficial, selecionar a conta de novas sessões e renomear perfis; sessões existentes conservam seu perfil. Cursor/OpenCode mantêm a conta padrão. Resets ganhos do Codex exigem um crédito disponível informado pela CLI, a mesma conta e confirmação; o app não compra créditos. Limites e protocolo: [uso de provedores](docs/development/provider-usage.md).

## Dados locais

Estado em Application Support (`com.switchyard.app`). Worktrees isolados ficam em `worktrees/` nesse diretório.

Não há conta do Switchyard ou nuvem obrigatória. Cada CLI usa sua própria autenticação; novas contas de Codex/Claude entram pelo login oficial em perfis separados.

A interface oferece Português (Brasil) e English, favoritos de modelos e barra lateral recolhível (⌘B). Tamanho de texto e atalhos são personalizáveis e persistidos; fechar com agentes ativos pode exigir confirmação. Recursos ainda sem implementação aparecem como “Em breve”. Codex e Claude retomam a conversa nativa exata e mostram aprovações revisáveis na sessão. OpenCode usa ACP para retomada exata e aprovação de arquivos; os últimos testes com a política endurecida esbarraram em APIError também presente na própria CLI. Cursor e Grok usam contexto textual limitado nos follow-ups. Rascunhos permanecem salvos sem envio automático.

Validações e limites do MVP: [progresso da sessão](docs/OVERNIGHT_PROGRESS.md). Arquitetura de providers, modelos, sessões e terminal: [runtime](docs/development/runtime.md).

## Aplicativo local

```bash
npm run build:desktop
open src-tauri/target/debug/bundle/macos/Switchyard.app
```

O build gera um app de desenvolvimento com assinatura ad hoc, sem publicação ou notarização. A galeria dos 100 componentes gratuitos do UI Arc fica em **Configurações → Avançado → Componentes UI Arc**. Os controles principais usam o kit com os tokens do Switchyard; componentes Pro ficam fora do escopo.

Codex, Claude Code e OpenCode foram exercitados com edições reais em worktrees descartáveis. Cursor também aplicou uma edição real com Auto-review e sandbox ativado, sem force/yolo. Aprovações manuais do Cursor continuam fora do protocolo deste adapter. O composer seleciona políticas nativas por turno, incluindo acesso completo explícito onde suportado; veja [ADR-017](docs/decisions/ADR-017-per-turn-approval-profiles.md). O composer permite anexar resumo do workspace e a prévia do diff selecionado, até 12 KiB.

Leia `AGENTS.md` para regras de agentes, arquitetura e segurança.

Documentação oficial do repositório (inglês): [`docs/`](docs/README.md).
