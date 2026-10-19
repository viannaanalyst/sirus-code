import { useId } from "react";
import { useTranslation } from "@/i18n/use-translation";
import { isPreviewUrlValid } from "@/lib/preview-url";

/** The scripts and their optional preview address (ADR-078, ADR-151). */
export interface ProjectScriptsDraft { setup: string; onFinish: string; previewUrl: string; openPreview: boolean }

/** Setup and On finish scripts in the Edit project dialog (ADR-078); saved with the dialog. */
export function ProjectScriptsFields({ scripts, disabled, onChange }: { scripts: ProjectScriptsDraft; disabled?: boolean; onChange: (next: ProjectScriptsDraft) => void }) {
  const t = useTranslation();
  const id = useId();
  const { setup, onFinish, previewUrl, openPreview } = scripts;
  const previewValid = isPreviewUrlValid(previewUrl);
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
    {field("setup", setup, (value) => onChange({ ...scripts, setup: value }))}
    {field("finish", onFinish, (value) => onChange({ ...scripts, onFinish: value }))}
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-preview`} className="ui-control text-text-secondary">{t("scripts.previewUrl")}</label>
      <input id={`${id}-preview`} aria-describedby={`${id}-preview-help`} aria-invalid={!previewValid || undefined} value={previewUrl} disabled={disabled} maxLength={512} spellCheck={false}
        placeholder={t("scripts.previewUrlPlaceholder")} onChange={(event) => onChange({ ...scripts, previewUrl: event.target.value })}
        className="selectable w-full rounded-[8px] border border-border-default bg-background-2 px-2 py-1.5 font-mono ui-caption text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent" />
      <p id={`${id}-preview-help`} className={previewValid ? "ui-caption text-text-muted" : "ui-caption text-danger"}>{t(previewValid ? "scripts.previewUrlHelp" : "scripts.previewInvalid")}</p>
    </div>
    <label className="flex items-center gap-2 ui-caption text-text-secondary">
      <input type="checkbox" checked={openPreview} disabled={disabled || !previewUrl.trim()} onChange={(event) => onChange({ ...scripts, openPreview: event.target.checked })} />
      {t("scripts.openPreview")}
    </label>
    <p className="ui-caption text-text-muted">{t("scripts.openPreviewHelp")}</p>
  </section>;
}
