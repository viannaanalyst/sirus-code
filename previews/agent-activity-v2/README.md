# Agent activity v2 previews

Open `index.html` directly. One self-contained page plays a simulated live turn (reads, edits, commands, two subagents with step progress) and supports Normal, Question, Permission and Failure scenarios, speed, theme and reduced motion. Everything uses only data the app already has in `TurnActivity` (provider, model, timing, waiting, status, items by kind/state, subagent labels, changed files).

All five variants keep the spinning-world icon from the original option 01, redrawn as SVG (planet, tilted ring, satellite travelling along the ring; amber while waiting, green when done, red on failure):

- **V1 Órbita viva** — option 01 evolved: the line shows the current action live (rolling ticker), counters bump when they grow, subagents become pills with their own orbit and `n/m` progress.
- **V2 Trilha** — timeline of steps; subagents branch with a step progress bar; older steps fold into “+N passos anteriores”. (The travelling comet was removed.)
- **V2b Trilha que se desenha** — the line paints itself down to the latest settled step; the running step's node is a small spinning planet, settled nodes pop into a check, and each step shows when it started. Unchanged steps keep their DOM so nothing restarts.
- **V2c Trilha em fases** — steps grouped into Explorar → Editar → Verificar; the current phase stays open, earlier phases fold into file chips with step count and duration; subagents become lanes with a progress bar and a moving sheen.
- **V3 Cartão de missão** — orbit inside an indeterminate progress ring, counter tiles, stacked subagents; finishing turns it into a summary with changed files and “Revisar alterações”.
- **V4 Constelação** — each subagent is a satellite orbiting the main planet, colored by state.
- **V5 Fita de ações** — a single line where actions enter from the right like a conveyor; the most compact.

Questions and permissions appear as an amber card that pauses the turn's clock; failures show a red card with the failing check. No production code is changed by this preview.
