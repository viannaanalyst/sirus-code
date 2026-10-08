# ADR-096: One entrance for menus and popups

**Status:** Accepted

## Context

Menus and popups entered in different ways: the shared Popover and Dropdown used `@starting-style` transitions, the context menu animated its items with its own keyframe, the usage popover had its own keyframes, the Environment card slid in from the right, and only the sidebar (now the Settings menu) cascaded its rows. The owner reported that popovers in the Environment card and the header project switcher showed no visible effect, and chose one entrance for all of them: the sidebar's row cascade plus a soft scale for the box.

Measured in WebKit (Playwright's WebKit, same engine as the app's WKWebView): `@starting-style` does apply, but the transition starts when the panel mounts, while Radix still holds it off-screen (`translate(0, -200%)`) waiting for its position. Its duration resolved to 140 ms (`--duration-fast` maps to `--motion-fast`), with the expo-out curve, a 4 px offset and a 0.97 scale. The first painted frame was already 30–50% opaque at 0.98 scale and the next at about 90%, so the entrance was over before it could be seen. Heavier content, like the switcher, delays the first paint further.

## Decision

- **Box:** popup boxes carry `data-popup` (Popover, Dropdown and ContextMenu; the Environment card uses it to set the lead). On `[data-state="open"]` they play the `popup-in` keyframe (opacity 0→1, `scale` 0.96→1, 160 ms `--motion-popup`, `--ease-out`) from the Radix transform origin. On `[data-state="closed"]` they play `popup-out`, a 100 ms fade (`--motion-popup-exit`), which Radix waits for before unmounting. Radix applies `animation: none` until the panel is positioned, so keyframes start on the first painted frame. The context menu and the Environment card are Motion components and use the same values.
- **Rows:** `@keyframes cascade-in` (opacity 0 and `translate: -10px 0`) in `src/styles/motion.css` replaces `sidebar-cascade-in`. Inside `[data-cascade]`, rows marked `[data-cascade-item]` take their index from an inline `--cascade-index` (`cascadeIndex()` in `src/lib/cascade.ts`). Every direct child of `[data-cascade="children"]` takes its index from `:nth-child()`. The sidebar row classes are still covered. Rows run for 320 ms (`--motion-slow`) after `--cascade-base + min(index, 10) × 22 ms`. Inside a popup the base is `--cascade-lead` (40 ms), so the box leads.
- **Where:** dropdown and context menu items always cascade, because those menus mount on open and their items do not change while open. Popovers opt in. The header project switcher cascades its project rows, footer actions and session column, but not the search field. The Environment card cascades its rows and section labels, and each row popover cascades its items. The Settings menu cascades its back row, group labels and pages each time it mounts: when Settings opens or its dock reopens, never when the page changes.
- **Only on open:** `useCascade(open)` keeps `data-cascade` for 640 ms after opening, which covers the last capped row. Rows that mount later, such as search results, late data or rows added by a click, simply appear. The switcher also drops it as soon as there is a query. This uses one timer per surface; there are no per-row timers, and the animations are CSS on opacity, translate and scale.
- **Motion settings:** with animations off or Reduce motion on (`html[data-animations="off"]`, `html[data-reduce-motion="on"]`), boxes and rows have no animation. Under `prefers-reduced-motion` rows do not cascade and boxes only fade.

## Consequences

- Module CSS for Popover, Dropdown and ContextMenu no longer defines entrances. Callers that need a different entrance must override the `[data-popup]` keyframes deliberately. The usage popover's own keyframes were removed.
- Popovers whose content changes while typing (model picker, composer suggestions, landing pickers) do not cascade unless they opt in. Even then, only direct children would animate, never the results inside a list.
- A row still animating when the switcher gets a query or closes jumps to its final state. Exits never cascade.
- `scripts/verify-cascade.mjs` renders the switcher, Environment card and Settings menu in SSR, with Radix portals rendered in place. It checks the attributes, the capped indices and the shared CSS.
