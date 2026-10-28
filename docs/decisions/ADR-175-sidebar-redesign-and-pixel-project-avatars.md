# ADR-175: Sidebar redesign and pixel project avatars

**Status:** Accepted (2026-10-28).

## Context

The conversation sidebar (ADR-139) had grown a crowded top: a brand line, history buttons, a
search field squeezed beside the list order, New project and New conversation, and a row of
Inbox and PRs. A project was a folder glyph that the owner could swap for an emoji, a logo, a line
icon or an Astro icon (ADR-059, ADR-116), tinted in one of nine colors. Most projects kept the
plain folder, so the list was a column of identical grey glyphs.

The owner approved a mockup (built outside the repo) with a calmer layout and a small pixel
speech bubble with a face for every project, in the Glass palette (ADR-167). Inbox is being
removed (another change) and Tasks and Archived are already gone (ADR-172, ADR-173), so the new
layout simply does not have them.

## Decision

### Layout (list mode)

- Header: the traffic-light inset, then Back, Forward, Hide sidebar (⌘S) and New conversation (⌘N).
  The "Sirus Code" brand line is gone.
- Search on its own line (opens the existing palette, ⌘K), then a **Pull requests** row with the
  unread dot the rail already shows (there is no count of pull requests in the app, so none is
  shown), a hairline, and a small muted **Projects** title with **+** (New project dialog) and the
  list order menu at its right.
- A project row is the avatar (24 px), the name and, at the end, the uncommitted `+/-` counts or
  the time of its latest conversation. An open project lists its conversations indented under a
  thin guide, the selected one highlighted, a running or waiting one with its status dot, and Show
  more as before. The footer keeps the plan usage (`AgentResources`), Usage and Settings.
- Everything else is unchanged: both list orders (Recent and By project), pins, drag to split,
  the delegated hover card and context menus, the held order while the pointer is over the list,
  windowing, folder open/close motion, snooze, unread and attention markers, project edits.
- The 52 px icon rail (`Sidebar.tsx`) is untouched except that its project shortcuts show the
  avatar. Inbox modules and rail items are left to the change that removes them.

### Avatars

- `src/lib/project-avatar.ts` is pure. A 12x12 bubble (mask, outline from the mask edge, a Bayer
  dithered light/base/shadow gradient, a highlight, a tail) plus one spare row for a bob. Colors are
  roles (outline, shadow, base, light, shine, white, cheek) built from one hex color in OKLCH, with
  hue drifting cool in shadows and warm in lights, so any picked color gets a coherent ramp. Faces
  are white with a one-pixel drop shadow in the outline tone; there is no black ink.
- Variants: 12 swatches and a free color picker, eyes `dot | round | wide | sleepy`, mouth
  `smile | o | flat`, cheeks on or off. Defaults come from an FNV-1a hash of the project name, so
  every project has a stable look with no setup. (The mockup indexed with signed shifts; the hash
  is read unsigned here so every name maps to a valid eye and mouth.)
- States: idle (blinks), working (a conversation of the project runs: glances sideways, the mouth
  moves, a two-frame bob) and waiting (a conversation needs the person, or finished unseen: happy
  `^ ^` eyes, cheeks and the violet corner notch). They come from `tabStatus` through
  `projectAvatarStates`, memoised on the session list, the unseen ids and the computer requests so
  many avatars cost one pass per change. Waiting wins over working, like `projectStatus`. Eyes
  follow a nearby pointer.
- `ProjectAvatar` paints the sprite into a canvas whose backing store is `12k` by `13k` device
  pixels, with `k = round(scale * devicePixelRatio)`, shown at `12 * scale` CSS pixels with
  `image-rendering: pixelated`, so each sprite pixel is a whole block at any density. `ProjectIcon`
  is the one place that picks the avatar scale from a glyph size and reads the project's state.

### Performance

- One `AvatarScheduler` (`src/lib/avatar-scheduler.ts`) serves every avatar; there is no
  requestAnimationFrame per icon. An avatar repaints only when its look, state or pose key
  changes. One shared 200 ms timer (about 5 fps) runs only while an avatar on screen is working;
  one shared blink timer (every 1.6 to 2.9 s, a third of the idle avatars per round, 140 ms each)
  runs only while an idle one is on screen. The pointer is watched by one passive listener, at
  most one pass per frame, only while an idle avatar is on screen, and only avatars whose gaze
  changed repaint. One `IntersectionObserver` marks which avatars are on screen (the windowed list
  mounts few anyway).
- Everything stops while the document is hidden or the window is not focused. With
  `data-animations="off"`, `data-reduce-motion="on"` or the OS reduced-motion preference, avatars
  draw one static frame (working without the bob, waiting still happy) and no timer or listener
  exists. With no avatar on screen, no timer runs at all. Previews in the appearance popover and
  the sidebar-style thumbnails are still frames that never join the scheduler.
- `tests/avatar-scheduler.test.ts` runs the scheduler against a fake clock and window to hold
  these rules.

### Appearance popover and persistence

- Clicking a project's avatar (a button beside the row's toggle, since a button cannot hold a
  button), or **Appearance…** in any project context menu, opens a small popover: colors, eyes,
  mouth, cheeks, Shuffle and Reset to default. It animates in and out like the other popups, edits
  show at once, and the choice is saved 250 ms after the last change (a color drag is one write).
- `Project.appearance?: { color, eyes, mouth, cheeks }` in `models.rs` and `src/client/types.ts`,
  omitted when absent. The command `set_project_appearance { projectId, appearance | null }`
  (`commands.rs`, next to `rename_project`) calls `sidebar::set_appearance`, which refuses
  anything but a `#rrggbb` color and the known eye and mouth names (`deny_unknown_fields`), lowercases
  the color, and saves through `persist::save`. `state.db` keeps each project as a JSON row
  (`store.rs`), so there is no migration: old rows have no `appearance` and load as before. The
  command is in `generate_handler!`, so the headless host and paired phones run it through the same
  table, and `load_state` returns the field to them. The UI tolerates an unknown value by falling
  back to the name default for that part.

### The old project icon

- Projects no longer render emoji, logos, line icons, Astro icons, tinted folders or their own
  favicon anywhere (sidebar, header tabs and switcher, hover card, working panel, rail shortcuts,
  computer switcher, sidebar-style thumbnails, phone home, projects, sessions, choose-project and
  new-session). The picker in the Edit project dialog, the phone's project-look screen, the
  `updateProjectLook` store action, `client.projectLookAction`, `client.projectAutoIcon` and the
  "Automatic project icons" setting row are removed.
- Older saved data still loads. `Project.look` stays in the Rust model and in `state.db` and is
  simply ignored (never rewritten, so nothing is lost if the owner goes back); the setting
  `projectAutoIcons` stays in `AppSettings`. Project folders (groups in the switcher) keep their
  own icon and picker (`ProjectGlyph`, `LookPicker`), since they have no avatar.
- Follow-up: prune `project_look_action`, `project_auto_icon` and the project half of
  `project_look.rs` once no older client needs them.

## Consequences

- Every project is recognisable at a glance with no setup, and the sidebar top is quieter.
- Avatars cost nothing at rest: no timers, no listeners. Working projects cost one 5 fps timer in
  total, however many are listed.
- The avatar scale is a whole number, so glyph boxes snap to 12, 24 or 36 px; 13 to 17 px slots
  (hover card, tabs, phone rows) show the 12 px sprite.
- A project's icon can no longer be a logo or an emoji. This is the owner's choice.
- Old `look` data lingers unused until the follow-up prune.
- Phones show the avatars and state but do not edit them yet; editing is desktop-only.
