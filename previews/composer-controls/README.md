# Composer control design previews

Open `index.html` to compare all five interactive designs, or open a numbered HTML file directly. Each file is self-contained, with embedded existing assets and no external dependencies, native IPC, network calls or credential access.

1. **Orbit (selected and refined):** one model trigger beside Send/Stop. The floating popup contains the effort slider, while its lightning icon toggles Fast directly. Clicking the model name switches to the provider/model list inside the same popup; selection returns to the slider. No separate effort button or visible Fast switch. The initial Opus 5 example matches the supplied refinement.
2. **Direct line:** effort slider always visible above the toolbar.
3. **Two speeds:** horizontal popover with separate effort and Fast controls.
4. **All in the selector:** provider rail, model list, effort and Fast share one popover.
5. **Lower strip:** persistent effort slider beneath the toolbar.

All variants put the model trigger immediately beside Send/Stop. Approval choices replace the previous shared-checkout control. Effort labels animate using opacity/translation and follow the selected model family's preview color, including models reached through Cursor/OpenCode. Pointer browsing preserves the selection. Per-model effort/Fast preferences, favorites and approval choices stay in memory only.

The effort bar has a prominent luminous cloud, drifting particles and a specular flare in normal mode; Fast adds branched traveling lightning arcs and brighter colors. Decorative layers are clipped to the filled region without being compressed by the fill's scale, keeping particles readable at medium/low effort. Continuous motion uses transforms on three small layers and stroke offset on a tiny lightning SVG; clipping updates only when effort changes. Cadence derives from motion tokens, and the selected effort/model identity stays intact. Animation pauses outside the viewport, in a hidden document, on the internal catalog page or when the slider popup closes. OS/preview reduced motion disables it. Targeted DOM checks passed normal/Fast state, stable effort, intersection/visibility, close/reopen and reduced-motion behavior for all six files.

The plus button opens an Add panel above the composer with exactly Files and folders, Goal and Planning mode. File/folder actions delegate to browser file inputs after an explicit click; the preview retains only filenames, sizes and folder file counts, displaying removable context chips. File contents are never read or uploaded. Directory selection is disabled if the browser does not expose `webkitdirectory`; empty directories cannot be represented by this browser picker. Goal editing and Planning mode are local UI demonstrations, not native agent execution settings. Tests passed picker-action dispatch with owned synthetic fixtures, duplicate handling, hostile-name escaping, cancellation, chip removal, goal editing and keyboard navigation.

The example catalogs, effort levels, colors and Fast support are illustrative design data, not verified vendor capabilities. Unavailable example Fast controls demonstrate the disabled state. Approval selection grants no permissions. Send/Stop explicitly simulates a local state change: it starts no process, sends no text and preserves the draft. Grok retains the existing neutral placeholder.

Keyboard support includes native range keys, model search, provider/model arrows, Home/End, Enter, Tab and Escape with focus return. Motion respects the OS preference and the preview's reduced-motion checkbox. The six HTML files passed DOM interaction checks covering provider scoping, model-family colors, exact qualified selection, per-model preference restoration, favorites, approval navigation and simulated Send/Stop. The selected Orbit revision additionally passed single-trigger/single-popup, direct Fast lightning, internal navigation/back, unavailable Fast and reset checks. No production components or native policies are changed by these previews.

Serve locally if desired:

```sh
python3 -m http.server 8768 --bind 127.0.0.1 --directory previews/composer-controls
```

Then open `http://127.0.0.1:8768/index.html`. Orbit is now implemented in the app with real, adapter-validated options and a native picker. These comparison files remain illustrative standalone previews; see [ADR-012](../../docs/decisions/ADR-012-composer-execution-and-attachments.md) for production behavior.
