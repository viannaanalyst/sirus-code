// Restores the last applied look (src/lib/settings.ts rememberAppearance) before the
// stylesheet paints, so a glass window opens as glass instead of the opaque theme colour.
// A file, not an inline script: the CSP allows only 'self' scripts.
(function () {
  try {
    var saved = JSON.parse(localStorage.getItem("sirus.appearance") || "null");
    if (!saved) return;
    var root = document.documentElement;
    for (var key in saved.dataset) root.dataset[key] = saved.dataset[key];
    if (saved.style) root.setAttribute("style", saved.style);
    root.classList.toggle("dark", saved.dark !== false);
  } catch (_error) {
    // No saved look (first launch, storage unavailable): the default paints.
  }
})();
