import { useTranslation } from "@/i18n/use-translation";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { selectListedSessions, useAppStore } from "@/store/app-store";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
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

  const sessions = useAppStore(selectListedSessions);
  const projects = useAppStore((state) => state.projects);
  const archivedIds = useAppStore((state) => state.settings.archivedSessionIds);
  // Chats come first: the five most recent, or every title match while typing (bounded).
  const chats = useMemo<CommandItem[]>(() => {
    if (!open) return [];
    const needle = query.trim().toLocaleLowerCase();
    const recent = [...sessions].filter((session) => needle ? session.title.toLocaleLowerCase().includes(needle) : !archivedIds.includes(session.id))
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
      .slice(0, needle ? 20 : 5);
    return recent.map((session) => ({
      id: `chat-${session.id}`, label: session.title, group: t("palette.recentChats"),
      icon: <ProviderIcon id={session.agent} size={16} />,
      meta: projects.find((project) => project.id === session.projectId)?.name,
      run: () => { const store = useAppStore.getState(); store.setMainView("session"); void store.selectSession(session.id); },
    }));
  }, [open, query, sessions, projects, archivedIds, t]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...chats, ...commands.filter((command) => command.label.toLowerCase().includes(needle))];
  }, [chats, commands, query]);

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
            placeholder={t("palette.placeholder")}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
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
            className="h-14 w-full bg-transparent px-5 ui-body text-text-primary outline-none placeholder:text-text-muted"
          />
          <div ref={list} id={listId} role="listbox" aria-label={t("Command palette")} className="scroll-thin max-h-[420px] overflow-y-auto px-2 pb-2">
            {grouped.length === 0 ? (
              <p className="px-2 py-6 text-center ui-body text-text-muted">{t("palette.empty")}</p>
            ) : (
              grouped.map(([group, items]) => (
                <div key={group} role="group" aria-label={group} className="mb-2">
                  <p className="px-3 pb-1 pt-2 ui-caption text-text-muted">{group}</p>
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
                        className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left ui-control ${
                          index === active ? "bg-background-3 text-text-primary" : "text-text-secondary"
                        }`}
                      >
                        {item.icon ? <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center text-text-muted [&_svg]:size-4">{item.icon}</span> : null}
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.meta ? <span className="max-w-[40%] shrink-0 truncate ui-caption text-text-muted">{item.meta}</span> : null}
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
