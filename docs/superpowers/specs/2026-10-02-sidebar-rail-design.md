# Sidebar rail and temporary panels

The owner approved the full two-line sidebar preview at `http://localhost:4194/`, then requested the collapsed-rail behavior shown in the supplied ChatGPT screenshots. These requests authorize implementation.

The rail always remains mounted. Expanded navigation reserves its existing resizable column; collapsed navigation reserves only a 52px rail. Hovering an enabled rail item previews its section in a Radix nonmodal Popover. Moving across the gap into that panel preserves it; leaving the rail and panel dismisses it after the existing short motion delay. Timers are revision-bound so an old leave cannot close a newer section. Keyboard focus and Arrow Right provide access; Escape dismisses with focus returned to the opening item. Hover never starts processes or changes the main view.

The panel header has an explicit pin control. Pinning commits the previewed section to the docked sidebar and uses the existing `sidebarCollapsed` preference. Releasing/recollecting leaves the rail visible. Temporary hover state, section/filter/search and width remain in memory. No new IPC, capabilities, provider state, persistence mechanism or application store is needed.

Home shows owned sessions once across Pinned, Drafts and Recent with title and actual project/worktree/branch metadata. Project inventory preserves the current pin, reorder, rename, removal and nested session actions. Kanban/archived/settings sections reuse existing navigation. PR chips only reuse current owner/workspace/branch-matching native snapshots; browsing the sidebar does not trigger network probes. Unavailable destinations remain visibly unavailable.

All panes reuse the shared palette/material tokens; floating panels use the existing marked Popover so embedded-browser occlusion continues to work. Buttons and badges retain opaque tokens. Motion uses only opacity/transform for floating panels and respects reduced motion. Existing drafts, sessions, terminals, worktrees, approvals and exact native identities are untouched.

Verification includes reducer race tests, owned/no-duplicate/filter feed tests, real component rendering with expanded/collapsed fixtures and both locales, frontend checks, native cargo check, signed desktop bundle and Graphify incremental update. No computer-use tools or real user/provider mutations are needed.
