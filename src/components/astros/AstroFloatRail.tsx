import type { CSSProperties } from "react";
import type { Astro } from "@/client/types";
import { Tooltip } from "@/components/arc/tooltip/tooltip";
import { AstroIcon } from "@/components/astros/AstroArt";
import { Plus } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { astroActivity } from "@/lib/astro-activity";
import { cn } from "@/lib/cn";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";
import "@/styles/astros.css";

/**
 * The floating chat's Astro rail (ADR-088), after MonoCode's Mono rail: every
 * Astro as on the main window's rail, the current one marked, then New Astro.
 * It dims while the window is in the background.
 */
export function AstroFloatRail({ astros, currentId, focused, overlay = false, onSelect, onCreate }: {
  astros: readonly Astro[];
  currentId: string;
  focused: boolean;
  overlay?: boolean;
  onSelect: (astroId: string) => void;
  onCreate: () => void;
}) {
  const t = useTranslation();
  const sessions = useAppStore(selectSessionsMeta);
  return <nav id="astro-float-rail" className={cn("astro-float-rail", overlay && "astro-float-rail-overlay")} data-focused={focused ? "true" : "false"} aria-label={t("astros.float.rail")}>
    <div className="astro-float-rail-list">
      {astros.map((astro) => {
        const current = astro.id === currentId;
        return <Tooltip key={astro.id} side="right" content={astro.name}>
          <button type="button" className="astro-float-rail-astro" aria-label={astro.name} aria-current={current ? "page" : undefined} style={{ "--astro": astro.color } as CSSProperties}
            onClick={() => { if (!current) onSelect(astro.id); }}>
            <AstroIcon icon={astro.icon} style={astro.style} color={astro.color} size={24} activity={astroActivity(astro, sessions)} />
            {astro.unread > 0 && !current ? <span className="astro-float-rail-dot" aria-hidden="true" /> : null}
          </button>
        </Tooltip>;
      })}
    </div>
    <Tooltip side="right" content={t("astros.new")}>
      <button type="button" className="astro-float-rail-add" aria-label={t("astros.new")} onClick={onCreate}>
        <Plus size={15} />
      </button>
    </Tooltip>
  </nav>;
}
