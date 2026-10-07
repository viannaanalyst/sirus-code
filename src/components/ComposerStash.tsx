import { Bookmark, X } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";

/** Drafts set aside with ⌘S (after T3 Code): a bookmark with their count that opens the list. */
export function ComposerStash({ items, open, onOpenChange, onRestore, onRemove }: { items: string[]; open: boolean; onOpenChange: (open: boolean) => void; onRestore: (index: number) => void; onRemove: (index: number) => void }) {
  const t = useTranslation();
  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverTrigger asChild>
      <button type="button" className="composer-stash" aria-label={t("stash.open", { count: items.length })} title={t("stash.hint")}>
        <Bookmark size={13} aria-hidden="true" /><span className="tabular-nums">{items.length}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" align="start" sideOffset={8} className="w-[min(460px,calc(100vw-40px))] p-1.5" aria-label={t("stash.title")}>
      <p className="px-2 pb-1 pt-0.5 ui-caption text-text-muted">{t("stash.title")}</p>
      {items.map((item, index) => <div key={`${index}:${item.slice(0, 24)}`} className="composer-stash-row group">
        <button type="button" className="min-w-0 flex-1 truncate text-left ui-control text-text-secondary hover:text-text-primary" onClick={() => onRestore(index)} title={item}>{item}</button>
        <button type="button" className="composer-stash-remove" aria-label={t("stash.remove")} onClick={() => onRemove(index)}><X size={12} aria-hidden="true" /></button>
      </div>)}
    </PopoverContent>
  </Popover>;
}
