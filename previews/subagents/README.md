# Subagent display previews (Stage 1)

Open `index.html` directly. One self-contained page plays a simulated turn where the main agent spawns three helpers. It runs on the shipped V2 trail and offers Claude or Codex naming, Normal, "Helper fails" and Stop scenarios, speed, theme and reduced motion.

Every helper shows only data the providers report. Nothing is invented: there is no total step count and no progress bar. The fields are:

- name;
- model;
- state;
- elapsed time;
- its own steps.

The sources are Claude `Agent`/`Task` calls with `parent_tool_use_id` messages and Codex `collabAgentToolCall` plus child-thread items. Each name gets a stable tint from a fixed palette.

- **S1 Ramo:** each helper is a trail row (orbit in its tint, name, model tag, step count, time). The current step shows underneath while it works. Clicking opens a branch with its steps, and a failure opens it automatically with the error. Inspired by MonoCode.
- **S2 Faixa sobre o composer:** the trail keeps one compact row per helper. A strip above the composer ("2 de 3 ajudantes trabalhando") lists each helper's current step and time while any helper is active, then leaves. Inspired by Synara.
- **S3 Raias:** the turn's helpers are grouped into one "Ajudantes · n de m concluídos" block, with one lane per helper and the steps expandable inline.

There are no per-helper controls. The composer's Stop ends the turn and every helper. Shipping child steps needs a bounded extension of ADR-035 activity: child step kind, label and state only, with no raw prompts or arguments.
