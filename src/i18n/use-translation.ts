import { useCallback } from "react";
import { useAppStore } from "@/store/app-store";
import { translate } from "./index";
export function useTranslation() {
  const locale = useAppStore((state) => state.settings.locale);
  return useCallback((key: string, params?: Record<string, string | number>) => translate(locale, key, params), [locale]);
}
