# Model picker design previews

Open `index.html` to compare all three interactive designs, or open each numbered HTML file directly. All files are self-contained and reuse bundled provider marks. No external fonts, scripts, network calls or native IPC.

1. Integrated icon rail with a shared model panel.
2. Named provider menu and right-hand flyout.
3. Detached icon dock and model panel.

Hover and click switch provider; search, favorite toggles, model selection, arrows, Enter, Tab and Escape are implemented. CSS motion respects reduced-motion preferences. Catalogs are explicit visual examples from the supplied screenshots/current naming conventions, not CLI discovery or availability claims. Favorites and selections live only in the preview's memory; sending/context/workspace actions are disabled. The owner selected option 1, now implemented by the production ModelSelector with real cached CLI catalogs and native preference persistence. Selected triggers show only an icon and model name.
