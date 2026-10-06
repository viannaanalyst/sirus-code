import type { Astro } from "@/client/types";
import { AstroIcon } from "@/components/astros/AstroArt";
import { PanelRight } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { astroActivity } from "@/lib/astro-activity";
import { IconButton } from "@/primitives/IconButton";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";
import "@/styles/astros.css";

/** Above an Astro's conversation: who it is, its projects, and its details drawer. */
export function AstroHeader({ astro }: { astro: Astro }) {
  const t = useTranslation();
  const projects = useAppStore((state) => state.projects);
  const sessions = useAppStore(selectSessionsMeta);
  const open = useAppStore((state) => state.astroDrawer?.astroId === astro.id);
  const names = astro.projectIds.map((id) => projects.find((project) => project.id === id)?.name).filter(Boolean).join(", ");
  const toggle = () => useAppStore.getState().setAstroDrawer(open ? null : { astroId: astro.id, page: "main" });
  return <div className="astro-header">
    <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={toggle}>
      <AstroIcon icon={astro.icon} style={astro.style} color={astro.color} size={34} activity={astroActivity(astro, sessions)} />
      <span className="min-w-0">
        <span className="block truncate ui-section text-text-primary">{astro.name}</span>
        <span className="block truncate ui-caption text-text-muted">{t("astros.subtitle", { projects: names || t("astros.noProjects") })}</span>
      </span>
    </button>
    <IconButton label={t("astros.details")} aria-pressed={open} onClick={toggle}><PanelRight size={15} /></IconButton>
  </div>;
}
