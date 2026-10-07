import type { ReactElement, ReactNode } from "react";
import { Tooltip as ArcTooltip } from "@/components/arc/tooltip/tooltip";
import { ShortcutHint } from "./ShortcutHint";

/** `secondary` adds one more action with its own shortcut (e.g. Send and start new thread). */
export function Tooltip({ label, shortcut, secondary, children }: { label: string; shortcut?: string; secondary?: { label: string; shortcut: string }; children: ReactElement }) {
  const main = shortcut ? <span className="shortcut-tooltip"><span>{label}</span><ShortcutHint keys={shortcut} /></span> : label;
  return <ArcTooltip content={secondary ? <span className="shortcut-tooltip-stack">{main}<span className="shortcut-tooltip"><span>{secondary.label}</span><ShortcutHint keys={secondary.shortcut} /></span></span> : main}>{children}</ArcTooltip>;
}

// Arc coordinates delay and skip behavior across all tooltips itself.
export function TooltipProvider({ children }: { children: ReactNode }) { return children; }
