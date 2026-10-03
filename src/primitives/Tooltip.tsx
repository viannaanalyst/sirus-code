import type { ReactElement, ReactNode } from "react";
import { Tooltip as ArcTooltip } from "@/components/arc/tooltip/tooltip";
import { ShortcutHint } from "./ShortcutHint";

export function Tooltip({ label, shortcut, children }: { label: string; shortcut?: string; children: ReactElement }) {
  return <ArcTooltip content={shortcut ? <span className="shortcut-tooltip"><span>{label}</span><ShortcutHint keys={shortcut} /></span> : label}>{children}</ArcTooltip>;
}

// Arc coordinates delay and skip behavior across all tooltips itself.
export function TooltipProvider({ children }: { children: ReactNode }) { return children; }
