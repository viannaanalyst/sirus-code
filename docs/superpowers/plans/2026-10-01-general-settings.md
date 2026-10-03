# General Settings Implementation Plan

> Execute inline in the authorized shared checkout; no commit, push or delegation is requested.

**Goal:** Apply the selected Orbit switch and the approved first General settings stage.

**Architecture:** Extend existing AppSettings with typed sort modes and three visibility
booleans. Retain the serialized native JSON save boundary. Sorting and section visibility
are presentation preferences; sessions, permissions and worktrees retain their owners.

**Tech Stack:** React 19, existing Radix, CSS/Motion preferences, Zustand, Tauri/Rust Serde.

## Constraints

- No dependencies, new IPC, permission changes, remote content or second state store.
- Legacy defaults: manual folders, creation-descending sessions, all three Environment sections visible.
- Native Project.addedAt/lastOpenedAt and Session.createdAt/lastActivityAt provide real timestamps.
- Pin precedence stays intact; manual movement selects manual mode and retains ownership validation.
- Default provider changes affect future sessions, preserve compatible defaults and clear foreign models.
- Individual reset changes only the selected preference (and a dependent foreign default model).
- Orbit motion is finite and respects disabled, animation and reduced-motion preferences.

## Tasks

- [x] Add regression cases in `tests/sidebar-layout.test.ts`: timestamp modes, pin precedence,
  stable invalid timestamps, no source mutation, drag after automatic sort returns manual.
  Add settings tests for legacy defaults, bad modes, and scoped provider/reset behavior.
- [x] Extend `src/client/types.ts`, `src/lib/settings.ts` and `src-tauri/src/models.rs` with
  `sidebarProjectSortOrder: manual|updated_at|created_at`, `sidebarThreadSortOrder: updated_at|created_at`
  and `showEnvironmentUsage/Repository/Editor`. Test Serde defaults, strict enum rejection and
  a native save/load round trip using disposable fixtures in `persist.rs`.
- [x] Update `sidebarGroups` using parsed timestamp caches and descending comparison:
  `pinDifference || dateDifference || originalIndexDifference`; preserve manual order cache.
  `moveSidebarProject` returns `{...settings, sidebarProjectSortOrder:'manual', sidebarProjectOrder:next}`.
- [x] Apply selected finite Orbit material to `src/primitives/Switch.tsx` and a dedicated CSS file,
  retaining Radix checked semantics, accessible names, disabled and keyboard behavior.
- [x] Add `GeneralSettings.tsx`: installed/enabled provider selector, new-session workspace,
  folder/session ordering, existing General preferences, Environment switches and per-row reset.
  Use existing group/row primitives, a grouped-card style and localized strings.
- [x] Conditionally mount real Environment Usage/Repository/Editor sections (including dividers);
  skip the repository metadata probe when its section is hidden. Other workspace actions stay mounted.
- [x] Update ADR-029, UI documentation and the reference mapping; run typecheck, lint, Node tests,
  native fmt/check/clippy/test, desktop build and incremental Graphify. Review security boundaries
  and verify generated bundle. No computer use, as requested.

## Verification

- Typecheck and ESLint passed.
- Node regression suite: 97 passed.
- Actual server renders: Orbit semantics/localized General/Environment visibility passed; Arc catalog 100/100.
- Rust fmt/check/clippy passed; native tests 151 passed, 17 opt-in live-provider tests ignored.
- Desktop bundle rebuilt and local signature verified. No computer use or live inference was performed.
- Incremental Graphify updated; its existing parser partially extracts the inline import type in app-store.ts, while TypeScript compilation passed.
