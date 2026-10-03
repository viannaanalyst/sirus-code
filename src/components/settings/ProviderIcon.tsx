import type { AgentProviderId } from "@/client/types";
import { PROVIDER_MARKS } from "@/lib/providers";
import { cn } from "@/lib/cn";

export function ProviderIcon({
  id,
  size = 28,
  className,
}: {
  id: AgentProviderId;
  size?: number;
  className?: string;
}) {
  const mark = PROVIDER_MARKS[id];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <img src={mark.src} alt="" width={size} height={size} className={cn("size-full object-contain", mark.monochrome && "brand-mark-monochrome")} />
    </span>
  );
}
