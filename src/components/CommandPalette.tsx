import { useTranslation } from "@/i18n/use-translation";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store/app-store";
import { ShortcutHint } from "@/primitives/ShortcutHint";
import type { CommandItem } from "@/lib/shortcuts";

export function CommandPalette({ commands }: { commands: CommandItem[] }) {
  const t = useTranslation();
  const open = useAppStore((state) => state.paletteOpen);
  const setOpen = useAppStore((state) => state.setPaletteOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [active, query]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return commands.filter((command) => command.label.toLowerCase().includes(needle));
  }, [commands, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const command of filtered) {
      map.set(command.group, [...(map.get(command.group) ?? []), command]);
    }
    return [...map.entries()];
  }, [filtered]);

  const run = (command: CommandItem) => {
    setOpen(false);
    setQuery("");
    setActive(0);
    command.run();
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) { setQuery(""); setActive(0); }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[8px] data-[state=open]:animate-[fadeIn_var(--motion-fast)_var(--ease-out)]" />
        <Dialog.Content data-appearance-floating="true"
          onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
          onCloseAutoFocus={(event) => {
            const target = returnFocus.current;
            const state = useAppStore.getState();
            if (target?.isConnected && !state.settingsOpen && !state.newSessionOpen) {
              event.preventDefault();
              target.focus({ preventScroll: true });
            }
          }}
          className="glass fixed left-1/2 top-[18%] z-50 w-[min(560px,calc(100%-32px))] -translate-x-1/2 overflow-hidden rounded-[16px] border border-border-default shadow-[var(--shadow-float)] data-[state=open]:animate-[popIn_var(--motion-fast)_var(--ease-out)] data-[state=closed]:animate-[popOut_var(--motion-instant)_var(--ease-out)]"
        >
          <Dialog.Description className="sr-only">{t("Search commands and projects.")}</Dialog.Description>
          <Dialog.Title className="sr-only">{t("Command palette")}</Dialog.Title>
          <input
            aria-label={t("Command palette")}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={filtered[active] ? `${listId}-${filtered[active].id}` : undefined}
            value={query}
            placeholder={t("Buscar comandos…")}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((value) => Math.max(0, Math.min(filtered.length - 1, value + 1)));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((value) => Math.max(0, value - 1));
              }
              if (event.key === "Enter" && filtered[active]) {
                event.preventDefault();
                run(filtered[active]);
              }
            }}
            className="h-12 w-full border-b border-border-subtle bg-transparent px-4 ui-body text-text-primary outline-none placeholder:text-text-muted"
          />
          <div ref={list} id={listId} role="listbox" aria-label={t("Command palette")} className="scroll-thin max-h-[360px] overflow-y-auto p-2">
            {grouped.length === 0 ? (
              <p className="px-2 py-6 text-center ui-body text-text-muted">{t("Nenhum comando")}</p>
            ) : (
              grouped.map(([group, items]) => (
                <div key={group} role="group" aria-label={group} className="mb-2">
                  <p className="px-2 py-1 ui-micro uppercase tracking-[0.14em] text-text-muted">{group}</p>
                  {items.map((item) => {
                    const index = filtered.indexOf(item);
                    return (
                      <button
                        key={item.id}
                        id={`${listId}-${item.id}`}
                        role="option"
                        aria-selected={index === active}
                        type="button"
                        onMouseEnter={() => setActive(index)}
                        onClick={() => run(item)}
                        className={`flex w-full items-center justify-between rounded-[8px] px-2 py-2 text-left ui-control ${
                          index === active ? "bg-background-3 text-text-primary" : "text-text-secondary"
                        }`}
                      >
                        <span>{item.label}</span>
                        {item.shortcut ? <ShortcutHint keys={item.shortcut} /> : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
