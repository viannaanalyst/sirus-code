/**
 * Phone viewport (ADR-084). iOS 26 home-screen apps measure every height
 * (`100%`, `100vh`, `100dvh`, `inset: 0`) short by the status bar, which leaves a
 * band at the bottom (WebKit 301108); `100lvh` is the one unit that reports the
 * full screen, so CSS uses it there (`--app-h`). While the keyboard is open the app
 * follows the visible area instead, so the composer sits right above the keyboard.
 */
export function keyboardOpen(fullHeight: number, visibleHeight: number): boolean {
  return fullHeight - visibleHeight > 120;
}

export function syncViewport(): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => undefined;
  const root = document.documentElement.style;
  let full = 0;
  let timers: ReturnType<typeof setTimeout>[] = [];
  const sync = () => {
    full = Math.max(full, viewport.height);
    const open = keyboardOpen(full, viewport.height);
    if (open) {
      root.setProperty("--app-h", `${viewport.height}px`);
      root.setProperty("--app-top", `${viewport.offsetTop}px`);
    } else {
      // The CSS value (100lvh) takes over again; clear any offset iOS leaves behind.
      root.removeProperty("--app-h");
      root.removeProperty("--app-top");
      if (window.scrollY) window.scrollTo(0, 0);
    }
  };
  // The keyboard animates; measure again once it has settled.
  const settle = () => {
    sync();
    timers.forEach(clearTimeout);
    timers = [setTimeout(sync, 70), setTimeout(sync, 240)];
  };
  const turn = () => { full = 0; settle(); };
  viewport.addEventListener("resize", settle);
  viewport.addEventListener("scroll", sync);
  window.addEventListener("focusout", settle);
  window.addEventListener("orientationchange", turn);
  sync();
  return () => {
    timers.forEach(clearTimeout);
    viewport.removeEventListener("resize", settle);
    viewport.removeEventListener("scroll", sync);
    window.removeEventListener("focusout", settle);
    window.removeEventListener("orientationchange", turn);
  };
}
