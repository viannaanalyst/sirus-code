import { useCallback, useEffect, useState } from "react";

export type SidebarMotion = "opening" | "closing" | null;

/** Tracks the docked sidebar's open/close transition so the frame can animate its width and keep the panel mounted while closing. */
export function useSidebarMotion(collapsed: boolean) {
  const [state, setState] = useState<{ collapsed: boolean; motion: SidebarMotion }>({ collapsed, motion: null });
  if (state.collapsed !== collapsed) setState({ collapsed, motion: collapsed ? "closing" : "opening" });
  const end = useCallback(() => setState(current => current.motion ? { ...current, motion: null } : current), []);
  // transitionend is the normal end; this only covers interrupted or skipped transitions.
  useEffect(() => {
    if (!state.motion) return;
    const timer = setTimeout(end, 800);
    return () => clearTimeout(timer);
  }, [state.motion, end]);
  return [state.motion, end] as const;
}

const CASCADE_ROWS = ".sidebar-panel-header, .sidebar-menu-row, .sidebar-project-row, .sidebar-session-row";
const CASCADE_LIMIT = 14;
const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** Staggers the rows currently inside a sidebar panel once. Rows added later appear normally. */
export function playSidebarCascade(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(CASCADE_ROWS).forEach((row, index) => row.style.setProperty("--cascade-index", String(Math.min(index, CASCADE_LIMIT - 1))));
  root.removeAttribute("data-cascade");
  void root.offsetWidth; // Restart the keyframes when replaying on the same node.
  root.setAttribute("data-cascade", "");
  clearTimeout(timers.get(root));
  timers.set(root, setTimeout(() => root.removeAttribute("data-cascade"), 1000));
}
