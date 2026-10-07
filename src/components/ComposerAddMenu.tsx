import { useRef, useState, type RefObject } from "react";
import { Box, Bug, Check, ChevronLeft, File, Folder, Lightbulb, Paperclip, Plus, Target, TerminalSquare, Users, X, AppWindow } from "@/components/icons/phosphor";
import { appendAttachments, replaceAttachment } from "@/lib/composer-attachments";
import { canPreviewAttachment } from "@/lib/document-reader";
import { client } from "@/client";
import { type ComposerContext, composerDebugging, composerPlanning, composerTeam, composerContextForOwner } from "@/lib/composer-context";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { composerPopoverLayout } from "@/lib/popover-position";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { useAppStore } from "@/store/app-store";
import { ComposerMetalSurface } from "@/components/ComposerMetalSurface";
import { ComposerImageAttachment } from "@/components/ComposerImageAttachment";
import { ComposerSkillPicker } from "@/components/ComposerSkillPicker";

export function ComposerAddMenu({ owner, disabled, context, onChange, planningAvailable, teamAvailable = false, boundaryRef }: {
  boundaryRef: RefObject<HTMLElement | null>;
  owner: string; disabled: boolean; context: ComposerContext; onChange: (context: ComposerContext) => void; planningAvailable: boolean; teamAvailable?: boolean;
}) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [layout, setLayout] = useState({ sideOffset: 6, alignOffset: 0, width: 320 });
  const [page, setPage] = useState<"add" | "goal" | "skills">("add");
  const [goal, setGoal] = useState("");
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = async (window = false) => {
    if (picking || disabled) return;
    setPicking(true); setError(null);
    try {
      const attachments = await (window ? client.capturePromptWindow(owner) : client.pickPromptAttachments(owner));
      // Preserve the owner captured when the OS picker opened, even if navigation changed.
      const state = useAppStore.getState();
      const current = composerContextForOwner(owner, state.composerContexts, state.sessions);
      if (attachments.length) {
        try { state.setComposerContext(owner, { ...current, attachments: appendAttachments(current.attachments, attachments) }); }
        catch (error) { await client.releasePromptAttachments(owner, attachments.map((file) => file.id)); throw error; }
      }
      if (attachments.length) setOpen(false);
    } catch (error) { setError(formatUnknownError(error)); }
    finally { setPicking(false); }
  };
  const item = "ui-control flex w-full items-center gap-2.5 rounded-[9px] px-2 py-2 text-left text-text-secondary hover:bg-background-3 hover:text-text-primary disabled:opacity-40";
  return <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) { setLayout(composerPopoverLayout(trigger.current, boundaryRef.current)); setPage("add"); setError(null); } }}>
    <PopoverTrigger asChild><button ref={trigger} type="button" disabled={disabled || picking} aria-label={t("composer.add")} className="composer-control composer-icon-control composer-metal-button titlebar-no-drag relative inline-flex shrink-0 items-center justify-center rounded-full text-text-secondary hover:text-text-primary disabled:opacity-40"><ComposerMetalSurface disabled={disabled || picking} /><Plus size={16} className="relative z-10" aria-hidden="true" /></button></PopoverTrigger>
    <PopoverContent side="top" align="start" sideOffset={layout.sideOffset} alignOffset={layout.alignOffset} style={{ width: layout.width, maxWidth: "calc(100vw - 20px)" }} className="max-h-[var(--radix-popover-content-available-height)] overflow-auto p-2" aria-label={t("composer.add")}>
      {page === "add" ? <><p className="px-2 pb-1 pt-1 ui-caption text-text-muted">{t("composer.add")}</p>
        <button type="button" className={item} disabled={disabled || picking} onClick={() => void choose()}><Paperclip size={15} className="shrink-0" /><span>{t("composer.filesFolders")}</span></button>
        <button type="button" className={item} disabled={disabled || picking} onClick={() => void choose(true)}><AppWindow size={15} aria-hidden="true" className="shrink-0" /><span className="shrink-0">{t("composer.attachWindow")}</span><span className="min-w-0 truncate text-text-muted">{t("composer.attachWindowHint")}</span></button>
        <button type="button" className={item} disabled={disabled || picking} onClick={() => setPage("skills")}><Box size={15} className="shrink-0" /><span>{t("skills.use")}</span></button>
        <button type="button" className={item} disabled={disabled || picking} onClick={() => { setGoal(context.goal); setPage("goal"); }}><Target size={15} aria-hidden="true" className="shrink-0" /><span className="shrink-0">{t("composer.goal")}</span><span className="min-w-0 truncate text-text-muted">{context.goal || t("composer.goalHint")}</span></button>
        <button type="button" className={item} aria-pressed={context.planning} disabled={disabled || picking || !planningAvailable} onClick={() => { onChange(composerPlanning(context, !context.planning)); setOpen(false); }}><Lightbulb size={15} aria-hidden="true" className="shrink-0" /><span className="shrink-0">{t("composer.planning")}</span><span className="min-w-0 flex-1 truncate text-text-muted">{t(planningAvailable ? context.planning ? "composer.planningOffHint" : "composer.planningHint" : "composer.planningUnavailable")}</span>{context.planning && planningAvailable ? <Check size={13} aria-hidden="true" className="shrink-0" /> : null}</button>
        <button type="button" className={item} aria-pressed={Boolean(context.debugging)} disabled={disabled || picking} onClick={() => { onChange(composerDebugging(context, !context.debugging)); setOpen(false); }}><Bug size={15} aria-hidden="true" className="shrink-0" /><span className="shrink-0">{t("composer.debugging")}</span><span className="min-w-0 flex-1 truncate text-text-muted">{t(context.debugging ? "composer.debugOffHint" : "composer.debugHint")}</span>{context.debugging ? <Check size={13} aria-hidden="true" className="shrink-0" /> : null}</button>
        <button type="button" className={item} aria-pressed={Boolean(context.team)} disabled={disabled || picking || !teamAvailable} onClick={() => { onChange(composerTeam(context, !context.team)); setOpen(false); }}><Users size={15} aria-hidden="true" className="shrink-0" /><span className="shrink-0">{t("team.mode")}</span><span className="min-w-0 flex-1 truncate text-text-muted">{t(teamAvailable ? "team.modeHint" : "team.modeUnavailable")}</span>{context.team && teamAvailable ? <Check size={13} aria-hidden="true" className="shrink-0" /> : null}</button>
      </> : <>
        <button type="button" onClick={() => setPage("add")} className="mb-2 flex items-center gap-1 rounded px-2 py-1 text-text-muted hover:text-text-primary"><ChevronLeft size={14} />{t("composer.add")}</button>
        {page === "skills" ? <ComposerSkillPicker key={owner} owner={owner} unavailable={disabled || picking} onSelect={() => setOpen(false)} /> : <form className="px-3 pb-2" onSubmit={(event) => { event.preventDefault(); onChange({ ...context, goal: goal.trim() }); setOpen(false); }}>
          <label htmlFor={`goal-${owner}`} className="mb-2 block ui-control text-text-secondary">{t("composer.goalHint")}</label>
          <textarea id={`goal-${owner}`} aria-describedby={`goal-scope-${owner}`} autoFocus disabled={disabled} value={goal} maxLength={400} onChange={(event) => setGoal(event.target.value)} rows={3} className="ui-body w-full resize-none rounded-[8px] border border-border-default bg-background-2 p-2 text-text-primary" />
          <p id={`goal-scope-${owner}`} className="mt-1.5 ui-caption text-text-muted">{t("composer.goalScope")}</p>
          <button type="submit" disabled={disabled} className="ui-control mt-2 rounded-[7px] bg-background-3 px-3 py-1.5">{t("common.save")}</button>
        </form>}
      </>}
      {picking ? <p role="status" className="px-3 py-2 text-text-muted">{t("composer.picking")}</p> : null}
      {error ? <p role="alert" className="selectable px-3 py-2 ui-control text-danger">{t(error)}</p> : null}
    </PopoverContent>
  </Popover>;
}
export function ComposerContextChips({ owner, context, disabled, onChange, planningAvailable }: {
  owner: string; context: ComposerContext; disabled: boolean; onChange: (context: ComposerContext) => void; planningAvailable: boolean;
}) {
  const t = useTranslation();
  const chip = "inline-flex max-w-full items-center gap-1.5 rounded-[8px] border border-border-subtle bg-background-3 px-2 py-1 ui-caption text-text-secondary";
  if (!context.attachments.length && !context.snippets?.length && !context.goal && !context.planning && !context.debugging && !context.team) return null;
  return <div className="flex flex-wrap items-center gap-2.5 pb-1 pl-[var(--composer-editor-padding-x)] pr-[var(--composer-editor-padding-x-end)] pt-[var(--composer-editor-padding-top)]">
    {context.attachments.map((attachment) => {
      const remove = () => onChange({ ...context, attachments: context.attachments.filter((item) => item.id !== attachment.id) });
      return attachment.previewUrl?.startsWith("data:image/")
        ? <ComposerImageAttachment key={attachment.id} attachment={attachment} owner={owner} disabled={disabled} onRemove={remove} onReplace={(next) => onChange({ ...context, attachments: replaceAttachment(context.attachments, attachment.id, next) })} />
        : <span key={attachment.id} className={chip} title={attachment.name}>
            {canPreviewAttachment(attachment) ? <button type="button" className="flex min-w-0 items-center gap-1.5 rounded hover:text-text-primary" aria-label={t("reader.open", { name: attachment.name })} onClick={() => useAppStore.getState().openAttachmentReader(owner, attachment)}><File size={12} aria-hidden="true" /><span className="max-w-44 truncate">{attachment.name}</span></button>
              : <><span aria-hidden="true">{attachment.kind === "folder" ? <Folder size={12} /> : <File size={12} />}</span><span className="max-w-44 truncate">{attachment.name}{attachment.truncated ? ` · ${t("composer.truncated")}` : ""}</span></>}
            <button type="button" disabled={disabled} aria-label={`${t("composer.removeAttachment")} · ${attachment.name}`} className="rounded p-0.5 hover:text-text-primary" onClick={remove}><X size={12} /></button>
          </span>;
    })}
    {(context.snippets ?? []).map((snippet) => <span key={snippet.id} className={chip} title={snippet.text}>
      <TerminalSquare size={12} aria-hidden="true" /><span className="max-w-44 truncate font-mono">{snippet.text.split("\n").find((line) => line.trim())?.trim() ?? t("terminal.snippet")}</span>
      <button type="button" disabled={disabled} aria-label={`${t("composer.removeAttachment")} · ${t("terminal.snippet")}`} className="rounded p-0.5 hover:text-text-primary" onClick={() => onChange({ ...context, snippets: (context.snippets ?? []).filter((item) => item.id !== snippet.id) })}><X size={12} /></button>
    </span>)}
    {context.goal ? <span className={chip} title={context.goal}><Target size={12} /><span className="max-w-44 truncate">{context.goal}</span><button type="button" disabled={disabled} aria-label={t("composer.removeGoal")} onClick={() => onChange({ ...context, goal: "" })} className="rounded p-0.5 hover:text-text-primary"><X size={12} /></button></span> : null}
    {context.planning ? <span className={chip}><Lightbulb size={12} />{t(planningAvailable ? "composer.planning" : "composer.planningUnavailable")}<button type="button" disabled={disabled} aria-label={t("composer.disablePlanning")} onClick={() => onChange({ ...context, planning: false })} className="rounded p-0.5 hover:text-text-primary"><X size={12} /></button></span> : null}
    {context.team ? <span className={chip}><Users size={12} aria-hidden="true" />{t("team.mode")}<button type="button" disabled={disabled} aria-label={t("team.disable")} onClick={() => onChange({ ...context, team: false })} className="rounded p-0.5 hover:text-text-primary"><X size={12} aria-hidden="true" /></button></span> : null}
    {context.debugging ? <span className={chip}><Bug size={12} aria-hidden="true" />{t("composer.debugging")}<button type="button" disabled={disabled} aria-label={t("composer.disableDebug")} onClick={() => onChange({ ...context, debugging: false })} className="rounded p-0.5 hover:text-text-primary"><X size={12} aria-hidden="true" /></button></span> : null}
  </div>;
}
