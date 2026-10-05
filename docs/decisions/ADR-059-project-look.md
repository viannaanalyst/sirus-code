# ADR-059: Project folder colour, emoji and logo

**Status:** Accepted

## Context

Every project in the sidebar shows the same folder icon. The owner wanted to keep the folder and add three choices, as in MonoCode: a folder colour, an emoji, or a logo image that replaces the folder.

## Decision

**Model.** `Project.look` holds an optional `color`, `emoji` and `logo`. The field is omitted from JSON when empty, so existing state files are unchanged. An emoji and a logo replace each other; the colour tints the folder or the initial.

**Rendering.** `ProjectGlyph` shows the logo, else the emoji, else the Phosphor folder (duotone when tinted). It is used in the project row, its hover card, Activity rows and rail project shortcuts. The editor lives in the Edit project dialog, which opens from the hover card and from the row's context menu.

**IPC.** One new command, `project_look_action`, with closed actions: `setColor`, `setEmoji`, `pickLogo`, `clearLogo`. Security review:

- **Colour:** one of nine preset names or `#rrggbb`; the renderer maps presets to tokens, so no CSS text is accepted.
- **Emoji:** at most 32 bytes and 10 characters, no whitespace or control characters.
- **Logo:** the renderer never sends a path or image bytes. `pickLogo` opens the native file dialog (PNG/JPEG filter). The file is at most 10 MiB and is decoded with limits (8192 px per side, 256 MiB allocation). It is cropped to the centre square, scaled to 96 px and re-encoded as PNG. The stored data URL is capped at 96 KiB.
- **Ownership:** the project ID must exist; the project folder is never read or written.

## Consequences

- **Positive:** projects are recognizable at a glance, and folders stay the default.
- **Negative:** logos add up to 96 KiB each to `state.json`.

## Alternatives considered

- **Generated icons (pixel creatures, shapes, monograms).** Rejected by the owner after previews.
- **Storing the logo as a file under app data.** Rejected: a small data URL needs no extra file lifecycle or asset protocol scope.
