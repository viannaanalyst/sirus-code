# Rascunhos e cabeçalho de atividade

Abra http://localhost:4193/ após iniciar `node previews/draft-activity/server.mjs` na raiz.

Esta prévia usa somente dados de exemplo em memória. Reiniciar recarrega dois rascunhos; nenhum texto vai para provedores ou para a persistência do app.

- **01 · Lápis na sessão**: conserva a organização atual por projeto e mostra um lápis discreto nos rascunhos.
- **02 · Seção Rascunhos**: reúne essas sessões em uma seção própria, sem duplicá-las em Recentes.
- Digitar, trocar de sessão e voltar recupera o texto; Limpar e Simular envio removem o lápis. Texto composto só de espaços não marca rascunho.
- Claro/Escuro/Sistema com translucidez opcional; controles e badges continuam legíveis.
- Abra a linha do modelo e seus grupos: seta para baixo recolhida, para cima aberta.

Os ícones são os assets locais do sistema. O cabeçalho real do app já usa `ModelIcon`, nome sem namespace de roteamento e essas orientações de seta. O indicador de rascunho da sidebar aguarda a escolha da prévia.
