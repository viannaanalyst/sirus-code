import { useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { HandoffIcon } from "@/components/icons/HandoffIcon";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { IconButton } from "@/primitives/IconButton";
import { useTranslation } from "@/i18n/use-translation";
import { providerById } from "@/lib/provider-registry";
import { useAppStore } from "@/store/app-store";
import type { Session } from "@/client/types";

/** Pending turn-level handoff; the recap travels with the first send. */
export function HandoffCard({ session }: { session: Session }) {
  const t = useTranslation();
  const dismissHandoff = useAppStore((state) => state.dismissHandoff);
  const [busy, setBusy] = useState(false);
  const handoff = session.handoff;
  if (!handoff?.pending) return null;
  return <div className="mx-3 mt-2 flex items-center gap-2 rounded-[var(--radius-md)] border border-border-subtle bg-background-3/50 px-2.5 py-1.5">
    <span className="flex shrink-0 items-center gap-1.5 ui-caption text-text-muted"><HandoffIcon size={14} />{t("Handoff")}</span>
    <span className="flex min-w-0 items-center gap-1.5 ui-control text-text-secondary">
      <ProviderIcon id={handoff.from} size={14} />
      <span className="truncate">{providerById(handoff.from).name}</span>
      <ChevronRight size={12} aria-hidden="true" className="shrink-0 text-text-muted" />
      <ProviderIcon id={session.agent} size={14} />
      <span className="truncate">{providerById(session.agent).name}</span>
    </span>
    {handoff.request ? <span className="min-w-0 flex-1 truncate ui-caption text-text-muted">{handoff.request}</span> : <span className="min-w-0 flex-1" />}
    <IconButton label={t("Remove handoff")} disabled={busy} onClick={() => {
      if (busy) return;
      setBusy(true);
      void dismissHandoff(session.id).finally(() => setBusy(false));
    }} className="size-6 min-h-0 shrink-0 rounded-[7px] p-0 text-text-muted"><X aria-hidden="true" size={13} strokeWidth={1.8} /></IconButton>
  </div>;
}
