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
