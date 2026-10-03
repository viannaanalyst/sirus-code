# Team (orchestrator V1) previews: Stage 2

Open `index.html` directly. One self-contained page simulates the whole flow in four phases. Use the phase list or ▶ to move through them:

1. **Request:** `+` → "Equipe" opens the team chip, with the coordinator model.
2. **Editable plan:** the coordinator proposes one card. For each task you can edit the title, provider and model, see its file scope (shared files are marked) and its dependency, and remove it. Nothing runs until "Confirmar e iniciar".
3. **Team at work:**
   - each worker runs in its own worktree and session;
   - a permission request goes to **you**, never to another model;
   - a dependent task waits for the task it builds on;
   - "Parar todos" stops every worker.
4. **Review and merge:** one worker at a time, in dependency order.
   - "Juntar" stays disabled until a prerequisite or shared-file predecessor is merged.
   - A shared-file overlap is flagged. A conflict applies nothing and is shown to you.
   - Merging is never automatic or forced.

The three variants change where the team lives:

- **E1 Tudo na conversa:** the plan, the live team card and the review card all sit in the coordinator chat, and the workers are nested in the sidebar. Inspired by MonoCode.
- **E2 Painel da equipe:** the plan is in the chat. After confirming, a right-dock "Equipe" pane groups workers into Precisa de você / Trabalhando / Esperando / Pronto para revisar, and the merge list ends the run there.
- **E3 Quadro:** the main area becomes a board with one lane per worker, showing live generic steps, and a bottom bar for stop and merge.

Toggles cover a worker permission request, a shared-file overlap, the theme and reduced motion.

Step labels are generic, matching ADR-035, and no production code changes.
