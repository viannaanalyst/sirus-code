import type { ComponentProps, ReactNode } from "react";
import { DropdownRoot, DropdownTrigger, DropdownContent as ArcContent, DropdownItem as ArcItem, DropdownSeparator } from "@/components/arc/dropdown-menu/dropdown-menu";
import { ShortcutHint } from "./ShortcutHint";
import { cn } from "@/lib/cn";
export const Dropdown = DropdownRoot;
export { DropdownTrigger, DropdownSeparator };
export function DropdownContent({ className, ...props }: ComponentProps<typeof ArcContent>) { return <ArcContent {...props} className={cn("ui-control", className)} />; }
/** Action items carry a real icon (menu style B); destructive ones read red. Choice lists keep their own marks. */
export function DropdownItem({ shortcut, icon, destructive, children, className, ...props }: ComponentProps<typeof ArcItem> & { shortcut?: string; icon?: ReactNode; destructive?: boolean; children: ReactNode }) {
  return <ArcItem {...props} className={cn("ui-control", destructive && "text-danger", className)}>{icon ? <span className={cn("inline-flex w-4 shrink-0 justify-center", destructive ? "text-danger" : "text-text-secondary")} aria-hidden="true">{icon}</span> : null}<span>{children}</span>{shortcut ? <ShortcutHint keys={shortcut} /> : null}</ArcItem>;
}
