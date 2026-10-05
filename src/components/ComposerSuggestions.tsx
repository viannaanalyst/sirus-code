import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { Box } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { fileIconFor, folderIconFor } from "@/lib/file-icons";
import type { useComposerSuggestions } from "@/lib/use-composer-suggestions";
import { cn } from "@/lib/cn";
import { PopoverContent } from "@/primitives/Popover";

export function ComposerSuggestions({ suggestions, area }: { suggestions: ReturnType<typeof useComposerSuggestions>; area: RefObject<HTMLTextAreaElement | null> }) {
  const t = useTranslation();
  const list = useRef<HTMLDivElement>(null);
  const { visible, listId, rows, index, loading, error, kind, truncated } = suggestions;
  useLayoutEffect(() => {
    if (visible) list.current?.querySelector(`[data-suggestion-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [visible, index, rows.length]);
  if (!visible) return null;
  return <PopoverContent side="top" align="start" sideOffset={8} onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()} onInteractOutside={event => { if (event.target === area.current) event.preventDefault(); }} className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-20px)] overflow-hidden p-0">
    <div className="flex items-center justify-between gap-3 border-b border-border-default px-3 py-2">
      <span className="ui-caption text-text-secondary">{t(kind === "skill" ? "skills.title" : "composer.files")}</span>
      <span className="ui-caption text-text-muted">{t("composer.suggestionKeys")}</span>
    </div>
    <div ref={list} id={listId} role="listbox" aria-label={t(kind === "skill" ? "skills.search" : "composer.files")} aria-busy={loading} className="scroll-thin max-h-[min(320px,40vh,var(--radix-popover-content-available-height))] overflow-y-auto p-1">
      {loading ? <p role="status" className="px-3 py-4 ui-description text-text-muted">{t(kind === "skill" ? "skills.loading" : "composer.filesLoading")}</p> : error ? <div className="px-3 py-3"><p role="alert" className="ui-description text-danger">{t(error)}</p><button type="button" onMouseDown={event => event.preventDefault()} onClick={suggestions.retry} className="mt-2 ui-control text-accent focus-visible:outline focus-visible:outline-accent">{t("common.retry")}</button></div> : !rows.length ? <p role="status" className="px-3 py-4 ui-description text-text-muted">{t(kind === "skill" ? "skills.noMatch" : "composer.filesEmpty")}</p> : rows.map((row, rowIndex) => {
        const icon = row.path ? row.directory ? folderIconFor(row.label, false) : fileIconFor(row.label) : null;
        const Icon = icon?.Icon ?? Box;
        return <button type="button" role="option" tabIndex={-1} id={`${listId}-${rowIndex}`} key={row.key} data-suggestion-index={rowIndex} aria-selected={rowIndex === index} onMouseDown={event => event.preventDefault()} onClick={() => suggestions.choose(row)} className={cn("flex w-full items-start gap-2.5 rounded-[var(--radius-md)] px-3 py-2 text-left hover:bg-background-3 focus-visible:bg-background-3", rowIndex === index && "bg-background-3")}>
          <Icon size={16} aria-hidden="true" style={icon ? { color: icon.color } : undefined} className="mt-0.5 shrink-0 text-text-muted" />
          <span className="min-w-0 flex-1"><span className="block truncate ui-control text-text-primary">{row.label}</span>{row.description && <span className="mt-0.5 block truncate ui-description text-text-muted">{row.description}</span>}</span>
        </button>;
      })}
    </div>
    {truncated && <p role="status" className="border-t border-border-default px-3 py-2 ui-caption text-text-muted">{t("composer.suggestionsLimited")}</p>}
  </PopoverContent>;
}
