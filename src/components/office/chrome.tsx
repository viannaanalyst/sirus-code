import type { ReactNode } from "react";
import { useTranslation } from "@/i18n/use-translation";

/** Shown while an Office engine, its worker or the document itself is loading. */
export function OfficeLoading() {
  const t = useTranslation();
  return <p role="status" className="p-6 text-text-muted">{t("reader.loading")}</p>;
}

export function OfficeNotice({ children }: { children: ReactNode }) {
  return <p role="status" className="shrink-0 border-b border-border-subtle bg-background-2 px-3 py-2 ui-caption text-text-secondary">{children}</p>;
}

/** The slide navigation strip's class, matching the PDF reader's toolbar. */
export const OFFICE_SUBHEADER_CLASS = "flex shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-1.5";
