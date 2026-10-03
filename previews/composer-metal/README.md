# Composer metal preview

Open `preview.html` directly for the standalone version, or run `npm run dev` from the project root and open `/previews/composer-metal/` on the Vite server. Rebuild the standalone file with `node previews/composer-metal/build-preview.mjs`.

The preview imports the current product styles, dimensions and shared liquid-metal material. Both the Add button and the 2 px composer rim use the same shader and material uniforms; the rim uses cover sizing to reach every side and corner as the composer changes shape. The rim is masked around a transparent center, with a bounded 131,072-pixel render budget and static CSS fallback when WebGL is unavailable. A compact native radio pill offers Slow, Smooth and Fast speeds, with Slow selected initially. Manual pause is independent of editing. Focusing the textarea stops shader time and softens the reflection; leaving resumes in place unless another pause condition remains active. Resize and visibility are handled by the shader mount; OS reduced motion retains a static reflection. Owned listeners and WebGL resources are released when the page closes.

Text entry, illustrative model/approval toggles and the Add popover work locally. Send only updates the preview status and preserves the text. Models and workspace labels are illustrative. This preview does not connect to native IPC or start agents.
