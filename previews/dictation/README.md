# Dictation composer studies

Five interactive visual studies built around Sirus Code's current composer,
design tokens, typography, orbital glyph and shared Paper metallic material:

1. **Silver line** — the reference's full-width recording strip and waveform.
2. **Capsule** — a compact chrome capsule around the mic and waveform.
3. **Orbit** — silver orbital trajectories around the microphone.
4. **Rails** — traveling light on two intersecting tracks beside the waveform.
5. **Halo** — soft rings around a restrained microphone control.

Open `/previews/dictation/` through Vite to compare all five. Individual
standalone files start with the chosen style. `preview.html` and the five
numbered HTML files embed all scripts, styles, fonts and images and also work
offline. Rebuild them with `node previews/dictation/build-preview.mjs`.

Use the state controls or microphone to start a simulated dictation. The sample
phrase appears progressively; Cancel restores the prior draft and Finish keeps
the visible text. Send is simulated. Tab selection supports arrows, Home and
End; Escape cancels when focus is inside the composer.

No microphone, Speech API, audio, provider, native IPC or saved application
state is accessed. Product dictation remains unchanged (ADR-025). The waveform
is an illustrative animation, not a measured audio level.

Only the selected visual animates. Motion pauses offscreen, on hidden documents,
on manual pause and under reduced motion. The clock and simulated transcript
advance only during the active preview. All observers, events, animation frames
and bounded shader mounts are disposed on pagehide and restored on pageshow.
The composer border is still while recording, keeping attention on the voice
feedback. Buttons retain a static chrome fallback if WebGL is unavailable.

Validation: `npx tsc --noEmit -p previews/dictation/tsconfig.json` and the scoped
Vite build. Source and all standalone variants use the same implementation.
