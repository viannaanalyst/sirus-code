import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { InteractiveButton } from "./InteractiveButton";
import { Tooltip } from "./Tooltip";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  tooltip?: boolean;
  children: ReactNode;
}

export function IconButton({ label, shortcut, tooltip = true, className, children, ...props }: Props) {
  const button = (
    <InteractiveButton variant="icon" aria-label={label} className={cn("rounded-full", className)} {...props}>
      {children}
    </InteractiveButton>
  );
  return tooltip ? <Tooltip label={label} shortcut={shortcut}>{button}</Tooltip> : button;
}
