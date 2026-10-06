import { useState } from "react";
import type { Astro } from "@/client/types";
import { AstroIcon } from "@/components/astros/AstroArt";
import { Clock3, NotebookText, Pencil, RotateCcw, Trash2 } from "@/components/icons/phosphor";
import { AstroPanel } from "@/components/astros/AstroPanel";
import { useTranslation } from "@/i18n/use-translation";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { IconButton } from "@/primitives/IconButton";
import { useAppStore } from "@/store/app-store";
import "@/styles/astros.css";

/** Above an Astro's conversation: who it is, its projects, and Appearance / New conversation / Delete. */
export function AstroHeader({ astro }: { astro: Astro }) {
  const t = useTranslation();
  const projects = useAppStore((state) => state.projects);
  const [confirm, setConfirm] = useState<"reset" | "delete" | null>(null);
  const names = astro.projectIds.map((id) => projects.find((project) => project.id === id)?.name).filter(Boolean).join(", ");
  return <div className="astro-header">
    <AstroIcon icon={astro.icon} style={astro.style} color={astro.color} size={34} />
    <div className="min-w-0 flex-1">
      <p className="truncate ui-section text-text-primary">{astro.name}</p>
      <p className="truncate ui-caption text-text-muted">{t("astros.subtitle", { projects: names || t("astros.noProjects") })}</p>
    </div>
    <IconButton label={t("astros.memory")} onClick={() => useAppStore.getState().setAstroPanel({ astroId: astro.id, tab: "memory" })}><NotebookText size={14} /></IconButton>
    <IconButton label={t("astros.habits")} onClick={() => useAppStore.getState().setAstroPanel({ astroId: astro.id, tab: "habits" })}><Clock3 size={14} /></IconButton>
    <IconButton label={t("astros.appearance")} onClick={() => useAppStore.getState().setAstroDialog({ editingId: astro.id })}><Pencil size={14} /></IconButton>
    <IconButton label={t("astros.reset")} onClick={() => setConfirm("reset")}><RotateCcw size={14} /></IconButton>
    <IconButton label={t("astros.delete")} onClick={() => setConfirm("delete")}><Trash2 size={14} /></IconButton>
    <ConfirmDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }} destructive
      title={t(confirm === "delete" ? "astros.deleteTitle" : "astros.resetTitle", { name: astro.name })}
      description={t(confirm === "delete" ? "astros.deleteBody" : "astros.resetBody")}
      confirmLabel={t(confirm === "delete" ? "astros.delete" : "astros.reset")} cancelLabel={t("common.cancel")}
      onConfirm={async () => { const store = useAppStore.getState(); if (confirm === "delete") await store.deleteAstro(astro.id); else await store.resetAstro(astro.id); setConfirm(null); }} />
    <AstroPanel />
  </div>;
}
