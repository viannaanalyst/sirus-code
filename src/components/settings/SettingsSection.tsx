import { useTranslation } from "@/i18n/use-translation";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export function SettingsSection({
  title,
  description,
  headerAction,
  children,
}: {
  title: string;
  description?: string;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      {headerAction ? <div className="flex flex-wrap items-start justify-between gap-4">
        <h2 className="ui-title text-text-primary">{title}</h2>
        <div className="shrink-0">{headerAction}</div>
      </div> : <h2 className="ui-title text-text-primary">{title}</h2>}
      {description ? <p className="mt-1.5 max-w-[42rem] ui-body text-text-muted">{description}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function SettingsGroup({ title, children, card = false }: { title: string; children: ReactNode; card?: boolean }) {
  return (
    <div className="mb-8 last:mb-0">
      <h3 className="mb-1 ui-section-title text-text-muted">{title}</h3>
      <div className={card ? "settings-group-card" : undefined}>{children}</div>
    </div>
  );
}

export function SettingsRow({
  title,
  description,
  comingSoon,
  children,
}: {
  title: string;
  description?: string;
  comingSoon?: boolean;
  children: ReactNode;
}) {
  const t = useTranslation();
  const labelId = useId();
  return (
    <div className="settings-row flex items-center justify-between gap-6 border-b border-border-subtle py-3 last:border-b-0">
      <div className="min-w-0 flex-1 pr-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <p id={labelId} className="ui-control font-medium text-text-primary">{title}</p>
          {comingSoon ? (
            <span className="ui-micro font-medium uppercase tracking-[0.08em] text-text-muted/55">{t("Coming soon")}</span>
          ) : null}
        </div>
        {description ? <p className="mt-0.5 ui-description text-text-muted">{description}</p> : null}
      </div>
      <div data-setting-label={labelId} className={cn("settings-row-control flex shrink-0 items-center gap-2", comingSoon && "pointer-events-none opacity-45")}>{children}</div>
    </div>
  );
}

export const SettingRow = SettingsRow;
