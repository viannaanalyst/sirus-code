import { createContext, useContext, useEffect, useId } from "react";

/** Keep a temporary panel alive while its portalled menu or dialog is in use. */
export const SidebarPanelHoldContext = createContext<((id: string, held: boolean) => void) | null>(null);
export function useSidebarPanelHold(open: boolean) {
  const hold = useContext(SidebarPanelHoldContext);
  const id = useId();
  useEffect(() => {
    if (!open || !hold) return;
    hold(id, true);
    return () => hold(id, false);
  }, [open, hold, id]);
}
