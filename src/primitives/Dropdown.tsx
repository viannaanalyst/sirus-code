import type { ComponentProps, ReactNode } from "react";
import { DropdownRoot, DropdownTrigger, DropdownContent as ArcContent, DropdownItem as ArcItem, DropdownSeparator } from "@/components/arc/dropdown-menu/dropdown-menu";
import { ShortcutHint } from "./ShortcutHint";
import { cn } from "@/lib/cn";
export const Dropdown = DropdownRoot;
export { DropdownTrigger, DropdownSeparator };
export function DropdownContent({ className, ...props }: ComponentProps<typeof ArcContent>) { return <ArcContent {...props} className={cn("ui-control", className)} />; }
export function DropdownItem({ shortcut, children, className, ...props }: ComponentProps<typeof ArcItem> & { shortcut?: string; children: ReactNode }) {
  return <ArcItem {...props} className={cn("ui-control", className)}><span>{children}</span>{shortcut ? <ShortcutHint keys={shortcut} /> : null}</ArcItem>;
}
