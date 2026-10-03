import type { AgentProviderId } from "@/client/types";
import { ProviderIcon } from "@/components/settings/ProviderIcon";

export function AgentIcon({ id, className }: { id: AgentProviderId; className?: string }) {
  return <ProviderIcon id={id} size={16} className={className} />;
}
