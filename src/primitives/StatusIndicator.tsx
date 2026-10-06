import { cn } from "@/lib/cn";
import type { SessionStatus } from "@/client/types";

export function StatusIndicator({ status }: { status: SessionStatus | "installed" | "missing" }) {
  const color =
    status === "running" || status === "starting"
      ? "bg-accent"
      : status === "failed"
        ? "bg-danger"
        : status === "completed" || status === "installed"
          ? "bg-success"
          : status === "waiting"
            ? "status-waiting"
            : "bg-text-muted/50";
  const pulse = status === "running" || status === "starting";
  return (
    <span
      className={cn(
        "inline-block size-1.5 rounded-full",
        color,
        pulse && "animate-pulse",
      )}
      aria-hidden
    />
  );
}
