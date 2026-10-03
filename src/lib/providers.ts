import type { AgentProviderId } from "@/client/types";
import claudeMark from "@/assets/providers/claude.svg";
import codexMark from "@/assets/models/openai.svg";
import cursorMark from "@/assets/providers/cursor.svg";
import opencodeMark from "@/assets/providers/opencode.svg";
import grokMark from "@/assets/providers/grok.svg";
import antigravityMark from "@/assets/providers/antigravity.svg";
import droidMark from "@/assets/providers/droid.svg";
import piMark from "@/assets/providers/pi.svg";
import devinMark from "@/assets/providers/devin.svg";

export { PROVIDERS, providerById, type ProviderDefinition } from "./provider-registry";

export interface BrandAsset { src: string; official: boolean; monochrome?: boolean }
export const PROVIDER_MARKS: Record<AgentProviderId, BrandAsset> = {
  claude: { src: claudeMark, official: true },
  codex: { src: codexMark, official: true, monochrome: true },
  cursor: { src: cursorMark, official: true, monochrome: true },
  opencode: { src: opencodeMark, official: true, monochrome: true },
  grok: { src: grokMark, official: true, monochrome: true },
  antigravity: { src: antigravityMark, official: true },
  droid: { src: droidMark, official: true, monochrome: true },
  pi: { src: piMark, official: true },
  devin: { src: devinMark, official: true, monochrome: true },
};
