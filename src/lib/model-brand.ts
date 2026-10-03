import { PROVIDER_MARKS, type BrandAsset } from "@/lib/providers";
import type { AgentProviderId } from "@/client/types";
import openaiMark from "@/assets/models/openai.svg";
import geminiMark from "@/assets/models/gemini.svg";
import unknownMark from "@/assets/models/unknown.svg";
import deepseekMark from "@/assets/models/deepseek.svg";
import kimiMark from "@/assets/models/kimi.svg";
import zaiMark from "@/assets/models/zai.svg";
import qwenMark from "@/assets/models/qwen.svg";
import minimaxMark from "@/assets/models/minimax.svg";
import mistralMark from "@/assets/models/mistral.svg";
import metaMark from "@/assets/models/meta.svg";
import nvidiaMark from "@/assets/models/nvidia.svg";
import hunyuanMark from "@/assets/models/hunyuan.svg";
import mimoMark from "@/assets/models/xiaomimimo.svg";
import longcatMark from "@/assets/models/longcat.svg";
import cohereMark from "@/assets/models/cohere.svg";

import type { ModelBrand } from "./model-brand-resolver";
export { resolveModelBrand } from "./model-brand-resolver";
export type { ModelBrand } from "./model-brand-resolver";

const BRAND_MARK: Record<ModelBrand, BrandAsset> = {
  ...PROVIDER_MARKS,
  openai: { src: openaiMark, official: true, monochrome: true },
  gemini: { src: geminiMark, official: true },
  unknown: { src: unknownMark, official: false },
  deepseek: { src: deepseekMark, official: true },
  kimi: { src: kimiMark, official: true, monochrome: true },
  zai: { src: zaiMark, official: true, monochrome: true },
  qwen: { src: qwenMark, official: false },
  minimax: { src: minimaxMark, official: false },
  mistral: { src: mistralMark, official: false },
  meta: { src: metaMark, official: false },
  nvidia: { src: nvidiaMark, official: false },
  hunyuan: { src: hunyuanMark, official: false },
  mimo: { src: mimoMark, official: false, monochrome: true },
  longcat: { src: longcatMark, official: false },
  cohere: { src: cohereMark, official: false },
};

export function modelBrandAsset(brand: ModelBrand) { return BRAND_MARK[brand]; }
export function providerBrandAsset(provider: AgentProviderId) { return PROVIDER_MARKS[provider]; }
