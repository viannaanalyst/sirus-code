# Team (orchestrator V1), simple variant E1

Open `index.html` directly. This is the chosen direction: everything happens in the coordinator's conversation, top to bottom.

1. **Request:** `+` → "Equipe" adds a chip, then you describe the work.
2. **Plan:** the coordinator explains the split in one sentence. The plan card lists each task with **what** and **who** (one provider · model picker), editable titles and removal. "Detalhes" reveals file areas, ordering and the per-worker worktree. Nothing runs before "Confirmar e iniciar".
3. **Team:** one line per worker with status, a live friendly step, time, and a button to open that worker's session.
   - A permission request appears inline and goes to you.
   - A dependent task shows "Esperando a tarefa 1".
   - "Parar todos" stops every worker.
   - Workers are nested under the coordinator in the sidebar.
4. **Finish:** the card totals files and lines and offers "Ver mudanças" per worker. **Juntar tudo** merges in dependency order, one at a time, and stops at the first conflict without applying that task. From the conflict you can view it, skip and continue, or ask the coordinator. A skipped task stays marked "Pulada" and keeps its worktree.

No production code changes.
