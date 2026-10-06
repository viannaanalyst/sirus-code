# Sidebar studies

Five interactive, isolated sidebar studies using Sirus Code typography, color and
motion tokens, Lucide icons, the existing Tooltip primitive and bundled provider
SVGs. No production Sidebar, store, native IPC or persisted state is changed.

1. **Prata essencial**: outline folders and flat, quiet rows.
2. **Dobras de metal**: folded silver folders, project separators and satin selection.
3. **Órbita**: small orbital folder details, reflective selection and wider session gaps.
4. **Trilhos**: blue folders, connected tree hierarchy and a narrow active marker.
5. **Camadas**: translucent folders and separately grouped project surfaces.

Open `/previews/sidebar/` through Vite. Each numbered HTML and `preview.html` is
also self-contained and can be opened offline. Build with
`node previews/sidebar/build-preview.mjs`; check the isolated source with
`npx tsc --noEmit -p previews/sidebar/tsconfig.json`.

## Reference behaviors verified in the local Synara source

Reference checkout: `../synara/apps/web/src/components/`, inspected 2026-10-01.
The previews implement the behavior with original host code and Lucide glyphs;
they do not copy Synara's Central icon assets.

- `Sidebar.tsx`, `renderProjectThreadActions`: project hover actions are **Code
  review**, **New terminal thread**, and **New thread**. Code review opens the
  project-scoped in-app pull request inbox, rather than directly opening GitHub.
- `Sidebar.tsx`, project header: its folder yields to a pin on hover/focus. Pinning
  sorts projects first within Projects. The folder row remains expandable.
- `ProjectHoverCardContent.tsx`: interactive hover card shows project name, pin,
  chat count, abbreviated path and Edit project. The edit action resolves to the
  project's rename flow. The preview changes only its in-memory sample name.
- `SidebarRowHoverActions.tsx`, `ThreadPinToggleButton.tsx`,
  `ThreadArchiveActionButton.tsx`: hovering/focusing a session reveals pin and
  archive without activating the row. The preview exposes archive restore.
- `ThreadHoverCardContent.tsx`: full title/time, project, branch, optional worktree,
  model, effort and optional live status. Synara additionally supports PR/source
  folder metadata when available. Sample rows omit PRs, rather than implying
  Sirus Code has Synara's pull request integration.
- Pinned sessions appear in **Fixadas**; these previews remove them from nested
  project lists, and unpinning returns them. Projects stay in **Projetos**.

All data is illustrative. Pin, archive, restore, expand, search, rename and reset
operate only in React component state; review/terminal/new-session actions report
a simulated action. No agent starts, no microphone is accessed and no file is read
by the preview. Tab arrows/Home/End, keyboard focus and reduced motion are handled.
Only bounded, event-driven hover dismissal timers are used, with unmount cleanup.

These studies are proposals for selection, not shipped session pin/archive
features. Product persistence and native authorization require a separate change
after the user chooses a design.
