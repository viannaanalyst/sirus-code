import { useId } from "react";
import { useTranslation } from "@/i18n/use-translation";

/** Setup and On finish scripts in the Edit project dialog (ADR-074); saved with the dialog. */
export function ProjectScriptsFields({ setup, onFinish, disabled, onChange }: { setup: string; onFinish: string; disabled?: boolean; onChange: (next: { setup: string; onFinish: string }) => void }) {
  const t = useTranslation();
  const id = useId();
  const field = (kind: "setup" | "finish", value: string, set: (value: string) => void) => <div className="flex flex-col gap-1">
    <label htmlFor={`${id}-${kind}`} className="ui-control text-text-secondary">{t(`scripts.${kind}`)}</label>
    <textarea id={`${id}-${kind}`} aria-describedby={`${id}-${kind}-help`} value={value} disabled={disabled} rows={2} maxLength={8192} spellCheck={false} placeholder={t(`scripts.${kind}Placeholder`)} onChange={(event) => set(event.target.value)}
      className="selectable w-full resize-y rounded-[8px] border border-border-default bg-background-2 px-2 py-1.5 font-mono ui-caption text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent" />
    <p id={`${id}-${kind}-help`} className="ui-caption text-text-muted">{t(`scripts.${kind}Help`)}</p>
  </div>;
  return <section className="mt-5 flex flex-col gap-3" aria-labelledby={`${id}-title`}>
    <div>
      <h3 id={`${id}-title`} className="ui-control text-text-primary">{t("scripts.title")}</h3>
      <p className="ui-caption text-text-muted">{t("scripts.help")}</p>
    </div>
    {field("setup", setup, (value) => onChange({ setup: value, onFinish }))}
    {field("finish", onFinish, (value) => onChange({ setup, onFinish: value }))}
  </section>;
}
