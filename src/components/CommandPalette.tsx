import { useTranslation } from "@/i18n/use-translation";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { selectListedSessions, useAppStore } from "@/store/app-store";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { ShortcutHint } from "@/primitives/ShortcutHint";
import type { CommandItem } from "@/lib/shortcuts";
import type { Session } from "@/client/types";
import { client } from "@/client";
import { SearchText } from "@/components/SearchText";
import { messageMatches, PALETTE_MESSAGE_QUERY, rankChats } from "@/lib/palette-search";

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
  // Chats come first: the five most recent, or the best title matches while typing (bounded).
  const chats = useMemo<CommandItem[]>(() => {
    if (!open) return [];
    const needle = query.trim();
    const recent = needle ? rankChats(sessions, needle, 20)
      : [...sessions].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).slice(0, 5);
    return recent.map((session) => ({
      id: `chat-${session.id}`, label: session.title, group: t("palette.recentChats"),
      icon: <ProviderIcon id={session.agent} size={16} />,
      meta: projects.find((project) => project.id === session.projectId)?.name,
      run: () => { const store = useAppStore.getState(); store.setMainView("session"); void store.selectSession(session.id); },
    }));
  }, [open, query, sessions, projects, t]);
  // Then chats whose messages match: native returns bounded candidates (transcripts may not be
  // loaded), matched here like the all-conversations search, one row per chat.
  const [found, setFound] = useState<{ query: string; sessions: Session[] } | null>(null);
  const needle = query.trim();
  const searching = open && needle.length >= PALETTE_MESSAGE_QUERY;
  useEffect(() => {
    if (!searching) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      client.searchTranscripts(needle).then((result) => {
        if (cancelled) return;
        const known = new Map(useAppStore.getState().sessions.map((session) => [session.id, session]));
        setFound({ query: needle, sessions: result.sessions.flatMap((candidate) => { const meta = known.get(candidate.sessionId); return meta ? [{ ...meta, messages: candidate.messages }] : []; }) });
      }, () => { if (!cancelled) setFound({ query: needle, sessions: [] }); });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [searching, needle]);
  const pending = searching && found?.query !== needle;
  const inMessages = useMemo<CommandItem[]>(() => {
    if (!searching || !found || found.query !== needle) return [];
    const listed = new Set(chats.map((chat) => chat.id.slice("chat-".length)));
    const owned = new Set(projects.map((project) => project.id));
    return messageMatches(found.sessions.filter((session) => owned.has(session.projectId)), needle, listed, 8).map(({ session, hit }) => ({
      id: `message-${session.id}`, label: session.title, group: t("palette.inMessages"),
      icon: <ProviderIcon id={session.agent} size={16} />,
      meta: projects.find((project) => project.id === session.projectId)?.name,
      detail: <SearchText text={hit.snippet} query={needle} />,
      run: () => { void useAppStore.getState().jumpToMessage(hit.sessionId, hit.messageId, hit.start); },
    }));
  }, [searching, found, needle, chats, projects, t]);
  const filtered = useMemo(() => {
    const lower = needle.toLowerCase();
    return [...chats, ...inMessages, ...commands.filter((command) => command.label.toLowerCase().includes(lower))];
  }, [chats, inMessages, commands, needle]);

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
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[8px] data-[state=open]:animate-[fadeIn_var(--motion-fast)_var(--ease-out)] data-[state=closed]:animate-[fadeOut_var(--motion-instant)_var(--ease-out)]" />
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
              <p className="px-2 py-6 text-center ui-body text-text-muted">{t(pending ? "palette.searchingMessages" : "palette.empty")}</p>
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
                        {item.detail ? (
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{item.label}</span>
                            <span className="block truncate ui-caption text-text-muted">{item.detail}</span>
                          </span>
                        ) : <span className="min-w-0 flex-1 truncate">{item.label}</span>}
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
