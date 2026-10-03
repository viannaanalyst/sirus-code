# Sidebar rail implementation plan

> **For agentic workers:** Execute this approved plan inline, task by task, with a focused review before completion.

**Goal:** Adopt the approved sidebar and add temporary hover panels with explicit docking.

**Architecture:** Keep the rail mounted inside the existing sidebar column. Read real inventories from Zustand; reuse Radix Popover and existing row/context actions. Use existing `toggleSidebar`/`save_settings` for docking and never add native commands.

**Tech Stack:** React 19, TypeScript, Zustand, Radix, Motion/CSS tokens, Tauri 2.

## Constraints

- Read AGENTS.md and ADR-029; query Graphify before architecture work.
- No Computer Use, new dependencies, native authority, provider launches, network probing on hover, or real fixture/user mutations.
- Native IDs, drafts, worktrees, pins and archive ownership remain unchanged.
- All visible controls are labeled, keyboard-accessible and localized.

## Tasks

- [x] Add `src/lib/sidebar-panels.ts`: closed section IDs, revision-bound temporary panel reducer, and owned feed grouping/filtering. Test enter A / leave A / enter B / stale close, pin, reset, foreign/archived drafts, pinned uniqueness and searching.
- [x] Extract the existing project inventory UI to `src/components/SidebarProjects.tsx`, preserving drag/Option reorder, context menus and empty-state actions. Add an activity variant to `SidebarSessionRow` for real two-line project/worktree/PR/branch metadata.
- [x] Replace `Sidebar` navigation with a permanent rail, docked/temporary shared panel, search/scope/sort and existing destinations. Preserve native browser occlusion through marked Radix Popover. Dock only on explicit pin/toggle.
- [x] Update App's sidebar mount and dock width accounting so collapsed reserves `SIDEBAR_RAIL_WIDTH = 52`. Keep the rail mounted through layout changes. Retain bounded manual resizing.
- [x] Update the browser preview at port 4194 with collapsed hover/dismiss/pin so the interaction remains reviewable.
- [x] Run Node reducer/feed tests and real Sidebar SSR fixtures in both locales. Run `npm run typecheck`, `npm run lint`, `npm test`, `cargo check`, `npm run build:desktop`, strict bundle-signature verification and `graphify update .`.
- [x] Review changed UI/state paths, fix important findings, and document the navigation behavior in ADR-029/AGENTS.md. This workspace has no .git, so no commit or PR is available.

## Verification

- 151 Node tests and BrowserPanel/skills/keybindings/appearance/sidebar SSR checks passed.
- TypeScript, ESLint and cargo check passed; desktop app bundled and strict local signature verification passed.
- Preview HTTP allowlist returned 200 for HTML/JS/CSS and 404 for unlisted files. A DOM harness exercised collapse, hover, pointer gap, stale leave, dismissal, docking and keyboard entry/Escape; no visual inspection was performed.
- Focused review identified hidden Drafts state in Archives and native browser edge occlusion; both were corrected and tested. The follow-up review found no remaining important issues.
- Incremental Graphify update completed. Its existing app-store extraction warning remains; no full rebuild was needed.
