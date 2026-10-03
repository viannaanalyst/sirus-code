import type { ModelBrand } from "@/lib/model-brand";
import { modelBrandAsset, resolveModelBrand } from "@/lib/model-brand";
import type { AgentProviderId } from "@/client/types";
import { cn } from "@/lib/cn";

export function ModelIcon({
  modelId,
  provider,
  size = 20,
  className,
}: {
  modelId: string;
  provider: AgentProviderId;
  size?: number;
  className?: string;
}) {
  const brand: ModelBrand = resolveModelBrand(modelId, provider);
  const mark = modelBrandAsset(brand);
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <img src={mark.src} alt="" width={size} height={size} className={cn("size-full object-contain", mark.monochrome && "brand-mark-monochrome")} />
    </span>
  );
}
