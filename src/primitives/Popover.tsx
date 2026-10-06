import { Popover, PopoverAnchor, PopoverTrigger, PopoverContent as ArcPopoverContent } from "@/components/arc/popover/popover";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
export { Popover, PopoverAnchor, PopoverTrigger };
export function PopoverContent({ className, ...props }: ComponentProps<typeof ArcPopoverContent>) {
  return <ArcPopoverContent {...props} className={cn("z-[80] min-w-48 p-1 ui-control text-text-primary", className)} />;
}
