import { useMemo } from "react";
import { useAppStore } from "@/store/app-store";

const SEPARATOR = "\u0000";

/**
 * Owners with a non-empty unsent draft, as a stable map. Composer typing replaces
 * `composerDrafts` on every key; subscribing to this joined key list instead means
 * sidebar groups recompute only when a draft appears or empties.
 */
export function useDraftOwners(): Record<string, string> {
  const keys = useAppStore((state) => Object.keys(state.composerDrafts).filter((key) => state.composerDrafts[key]?.trim()).sort().join(SEPARATOR));
  return useMemo(() => Object.fromEntries(keys ? keys.split(SEPARATOR).map((key) => [key, "1"]) : []), [keys]);
}
