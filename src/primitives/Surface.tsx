import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface Props extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
  glass?: boolean;
}

export function Surface({ elevated, glass, className, ...props }: Props) {
  return (
    <div
      className={cn(
        "border border-border-subtle bg-background-1",
        elevated && "bg-background-2 shadow-[var(--shadow-float)]",
        glass && "glass",
        className,
      )}
      {...props}
    />
  );
}
