# ADR-089: Chat background, project icon picker and rail pages

**Status:** Accepted

## Context

Several pieces of UI fell short of MonoCode and Synara:
- MonoCode lets a person put an image behind the chat.
- Synara edits a project's icon from a picker attached to its name, with Emoji and Icons tabs, colours and a search. Sirus spread emoji, Astro and logo choices over separate chips.
- On the rail, Kanban and Archived opened a floating panel while Tasks opened its page.
- Synara cycles reasoning effort with ⇧⇥ in the composer.

## Decision

1. **Chat background.**
   - Settings → Appearance → Chat background picks a PNG or JPEG natively (`chat_background_action`).
   - The image is decoded with bounds (at most 30 MiB and 12,000 px), scaled to at most 2560 px and saved as `backgrounds/chat-<uuid>.jpg` next to `state.json`. Older backgrounds are removed.
   - Settings keep only the file name (`chatBackground`, validated natively) and a veil (`chatBackgroundDim`, 0–90%, default 70%) of the theme colour that keeps text readable.
   - The renderer loads the image as a data URL (`chat_background_image`) and draws it behind `.session-pane`, in the main window and the floating Astro chat.
   - Picking is refused to paired phones, because the dialog opens on the Mac.
2. **Project icon picker.**
   - Edit project now shows the name field with the icon at its left.
   - The icon opens one picker with three tabs:
     - Emoji, which also accepts a typed emoji;
     - Icons, 58 line icons with a Portuguese and English search;
     - Astros, with Metal or Neon.
   - The picker also holds the colours and the custom colour, "Use an image…" and "Remove icon".
   - Line icons are a new look kind, `ProjectLook.icon`, checked against `project_look::ICONS`. A test keeps the TypeScript map in step with that list. As before, one icon kind replaces the others.
3. **Rail pages.** Kanban and Archived open their pages directly, like Tasks. Archived sessions get a page with Restore, and only Home keeps the floating sessions panel.
4. **Effort shortcut.** `cycle-effort` (⇧⇥ by default, customizable) moves the composer to the next reasoning level the model supports. It is the only binding allowed a Tab without ⌘, and both the TypeScript and Rust validators accept it only for this id.

## Consequences

- The background never leaves the Mac. Phones show it too, through the same command.
- Project scripts stay in Edit project below the name, until they get a place of their own.
