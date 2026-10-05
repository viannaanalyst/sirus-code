import { useEffect, useId, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { client } from "@/client";
import type { WorkspaceFiles } from "@/client/types";
import { composerTrigger, completeComposerToken, suggestionIndex } from "@/lib/composer-suggestions";
import { filterSkills, skillContextKey } from "@/lib/skills";
import { useSkillsCatalog } from "@/lib/use-skills-catalog";
import { formatUnknownError } from "@/lib/format-error";
import { useAppStore } from "@/store/app-store";
import { availableCommands, commandPosition, filterCommands, type CommandContext, type ComposerCommandId } from "@/lib/composer-commands";
import { translate } from "@/i18n";

export interface ComposerSuggestion { key: string; label: string; description: string; path?: string; directory?: boolean; command?: ComposerCommandId }

/** App commands join the `/` list; `run` receives the chosen command after its token leaves the draft. */
export interface ComposerCommands { context: CommandContext; run: (id: ComposerCommandId) => void }

export function useComposerSuggestions(ownerKey: string, value: string, area: RefObject<HTMLTextAreaElement | null>, unavailable: boolean, commands?: ComposerCommands) {
  const listId = useId();
  const [cursor, setCursor] = useState({ ownerKey, value, start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState("");
  const [selection, setSelection] = useState({ key: "", index: 0 });
  const owner = { projectId: ownerKey.startsWith("project:") ? ownerKey.slice(8) : null, sessionId: ownerKey.startsWith("session:") ? ownerKey.slice(8) : null };
  const contextKey = useAppStore(state => skillContextKey(state, owner));
  const disabledSkills = useAppStore(state => state.settings.disabledSkills);
  const trigger = focused && !unavailable && !composing && cursor.ownerKey === ownerKey && cursor.value === value ? composerTrigger(value, cursor.start, cursor.end) : null;
  const identity = JSON.stringify([ownerKey, contextKey, value, cursor.start, cursor.end]);
  const visible = trigger !== null && identity !== dismissed;
  const kind = visible ? trigger.kind : null;
  const query = visible ? trigger.query : "";
  const requestKey = JSON.stringify([ownerKey, contextKey, kind, query]);
  const { catalog, loading: skillsLoading, error: skillsError, refresh } = useSkillsCatalog(owner, kind === "skill");
  const [files, setFiles] = useState<{ key: string; data: WorkspaceFiles | null; error: string | null }>({ key: "", data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const { projectId, sessionId } = owner;
  useEffect(() => {
    if (kind !== "file") return;
    let cancelled = false;
    // Edit-driven debounce, never a poll or a background workspace index.
    const timer = window.setTimeout(() => {
      void client.workspaceFiles({ projectId, sessionId }, query).then(data => {
        if (!cancelled) setFiles({ key: requestKey, data, error: null });
      }).catch((error: unknown) => {
        if (!cancelled) setFiles({ key: requestKey, data: null, error: formatUnknownError(error) });
      });
    }, 120);
    return () => { window.clearTimeout(timer); cancelled = true; };
  }, [kind, query, projectId, sessionId, requestKey, attempt]);
  const fileData = files.key === requestKey ? files : null;
  const loading = kind === "skill" ? skillsLoading : kind === "file" && fileData === null;
  const error = kind === "skill" ? skillsError : fileData?.error ?? null;
  const locale = useAppStore(state => state.settings.locale);
  const skillRows: ComposerSuggestion[] = kind === "skill" ? filterSkills(catalog?.skills ?? [], query, disabledSkills, true).map(skill => ({ key: skill.name, label: `/${skill.name}`, description: skill.description })) : [];
  // A skill named exactly like the query keeps the first place, so an existing
  // `/name` + Enter still picks that skill; app commands follow, then other skills.
  const commandRows: ComposerSuggestion[] = kind === "skill" && commands && trigger && commandPosition(value, trigger.start)
    ? filterCommands(availableCommands(commands.context), query).map(command => ({ key: `command:${command.id}`, label: `/${command.id}`, description: translate(locale, command.description), command: command.id }))
    : [];
  const exact = skillRows.filter(row => row.key === query);
  const rows: ComposerSuggestion[] = kind === "skill"
    ? [...exact, ...commandRows, ...skillRows.filter(row => row.key !== query)]
    : kind === "file" ? (fileData?.data?.entries ?? []).map(entry => ({ key: entry.path, label: entry.path.split("/").at(-1)! + (entry.isDir ? "/" : ""), description: entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "", path: entry.path, directory: entry.isDir })) : [];
  const index = selection.key === requestKey ? Math.min(selection.index, Math.max(0, rows.length - 1)) : 0;
  const syncCursor = (node: HTMLTextAreaElement) => setCursor({ ownerKey, value: node.value, start: node.selectionStart, end: node.selectionEnd });
  const choose = (row: ComposerSuggestion) => {
    if (!trigger || (loading && !row.command) || unavailable) return;
    const store = useAppStore.getState();
    if ((store.composerDrafts[ownerKey] ?? "") !== value || skillContextKey(store, owner) !== contextKey) return;
    if (row.command) {
      // Commands act on the app: the token leaves the draft and is never sent as text.
      const rest = (value.slice(0, trigger.start) + value.slice(trigger.end)).trimStart();
      store.setComposerDraft(ownerKey, rest);
      setDismissed(JSON.stringify([ownerKey, contextKey, rest, 0, 0]));
      setCursor({ ownerKey, value: rest, start: 0, end: 0 });
      commands?.run(row.command);
      return;
    }
    if (trigger.kind === "skill" && store.settings.disabledSkills.includes(row.key)) return;
    const next = completeComposerToken(value, trigger, row.path ?? row.key, row.directory);
    store.setComposerDraft(ownerKey, next.value);
    if (!row.directory) setDismissed(JSON.stringify([ownerKey, contextKey, next.value, next.caret, next.caret]));
    setCursor({ ownerKey, value: next.value, start: next.caret, end: next.caret });
    requestAnimationFrame(() => {
      if ((useAppStore.getState().composerDrafts[ownerKey] ?? "") !== next.value) return;
      if (area.current?.dataset.draftOwner !== ownerKey) return;
      area.current?.focus();
      area.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  const dismiss = () => setDismissed(identity);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!visible || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); return true; }
    if (event.key === "Enter" && !event.shiftKey && error) { event.preventDefault(); retry(); return true; }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && rows.length) {
      event.preventDefault(); setSelection({ key: requestKey, index: suggestionIndex(index, event.key === "ArrowDown" ? 1 : -1, rows.length) }); return true;
    }
    if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && (rows.length || loading)) {
      event.preventDefault(); if (rows[index]) choose(rows[index]); return true;
    }
    if (event.key === "Tab") dismiss();
    return false;
  };
  const retry = () => { if (kind === "skill") void refresh(); else { setFiles({ key: "", data: null, error: null }); setAttempt(current => current + 1); } };
  return {
    visible, kind, listId, rows, index, loading, error, choose, onKeyDown, syncCursor,
    hasCommands: commandRows.length > 0,
    truncated: kind === "skill" ? catalog?.truncated ?? false : fileData?.data?.truncated ?? false,
    onFocus: (node: HTMLTextAreaElement) => { setFocused(true); syncCursor(node); },
    onBlur: () => setFocused(false),
    onCompositionStart: () => setComposing(true),
    onCompositionEnd: (node: HTMLTextAreaElement) => { setComposing(false); syncCursor(node); },
    retry, dismiss,
  };
}
