import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}

export function SidebarItem({
  active,
  leading,
  trailing,
  className,
  children,
  ...props
}: Props) {
  return (
    <div
      className={cn(
        "group relative flex h-[30px] w-full items-center rounded-[7px] text-left ui-control text-text-secondary transition-colors duration-[var(--motion-fast)]",
        "hover:bg-white/5 hover:text-text-primary",
        active && "bg-white/8 text-text-primary",
        className,
      )}
    >
      <button type="button" className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-[7px] px-2 text-left" {...props}>
      {leading ? <span className="flex size-4 items-center justify-center text-text-muted">{leading}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      </button>
      {trailing ? <span className="mr-1 flex shrink-0 items-center">{trailing}</span> : null}
    </div>
  );
}
