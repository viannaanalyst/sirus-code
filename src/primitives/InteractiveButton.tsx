import type { ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/arc/button/button";
import { cn } from "@/lib/cn";
import { clearPointerGlow, setPointerGlow } from "@/lib/pointer-glow";

type Variant = "primary" | "danger" | "secondary" | "ghost" | "icon" | "toolbar";

interface Props extends Omit<ButtonProps, "variant"> {
  variant?: Variant;
  loading?: boolean;
  glow?: boolean;
  children: ReactNode;
}

const variants: Record<Variant, string> = {
  primary:
    "h-8 px-3 bg-accent/90 text-background-0 font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.28)] hover:bg-accent",
  // Destructive confirmations (delete, remove, discard) are always red.
  danger:
    "h-8 px-3 bg-danger text-white font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-danger/90",
  secondary:
    "h-8 px-3 bg-background-2 text-text-primary border border-border-subtle hover:border-border-default hover:bg-background-3",
  ghost: "h-8 px-2.5 text-text-secondary hover:text-text-primary hover:bg-background-3/80",
  icon: "size-8 text-text-secondary hover:text-text-primary hover:bg-background-3/80",
  toolbar:
    "h-7 px-2 ui-control text-text-secondary hover:text-text-primary hover:bg-background-3/70 border border-transparent hover:border-border-subtle",
};

export function InteractiveButton({
  variant = "secondary",
  loading = false,
  glow = true,
  className,
  disabled,
  children,
  ...props
}: Props) {
  return (
    <Button
      type="button"
      variant={variant === "primary" || variant === "danger" ? "primary" : variant === "secondary" ? "secondary" : "ghost"}
      size={variant === "toolbar" ? "sm" : "md"}
      disabled={disabled}
      loading={loading}
      onPointerMove={glow ? setPointerGlow : undefined}
      onPointerLeave={glow ? clearPointerGlow : undefined}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-[10px] ui-control disabled:opacity-40 disabled:pointer-events-none",
        glow && "interactive-glow",
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}
