import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { MessageSquarePlus, MessagesSquare } from "@/components/icons/phosphor";
import { useTranslation } from "@/i18n/use-translation";
import { appendTranscriptQuote, readTranscriptSelection, type TranscriptSelection } from "@/lib/transcript-selection";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Popover, PopoverAnchor, PopoverContent } from "@/primitives/Popover";
import { useAppStore } from "@/store/app-store";

function TranscriptSelectionMenuView({ sessionId, viewport }: { sessionId: string; viewport: RefObject<HTMLDivElement | null> }) {
  const t = useTranslation();
  const [selection, setSelection] = useState<TranscriptSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const dismiss = useCallback(() => { setSelection(null); setError(null); }, []);
  const anchor = useMemo(() => ({ current: { getBoundingClientRect: () => selection?.rect ?? new DOMRect() } }), [selection]);

  useEffect(() => {
    const root = viewport.current;
    if (!root) return;
    let frame = 0, dragging = false;
    const report = () => {
      frame = 0;
      // Tabbing to the action may collapse the browser selection. Retain its snapshot.
      if (popup.current?.contains(document.activeElement)) return;
      setSelection(readTranscriptSelection(root, window.getSelection()));
      setError(null);
    };
    const schedule = () => {
      if (dragging || frame) return;
      frame = requestAnimationFrame(report);
    };
    const down = (event: PointerEvent) => {
      if (root.contains(event.target as Node)) {
        dragging = true;
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        dismiss();
      }
    };
    const up = () => { if (dragging) { dragging = false; schedule(); } };
    const cancel = () => { dragging = false; dismiss(); };
    // Scrolling (also the transcript following a streaming reply) or resizing re-reads the
    // selection, so the popup moves with it and only closes once it leaves the view.
    const moved = () => schedule();
    // A double or triple click selects a word or line; read it once the click settles.
    const clicked = (event: MouseEvent) => {
      if (event.detail < 2 || !root.contains(event.target as Node)) return;
      dragging = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      schedule();
    };
    const tab = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing || !popup.current) return;
      event.preventDefault();
      popup.current.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    };
    root.addEventListener("keydown", tab);
    document.addEventListener("selectionchange", schedule);
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("click", clicked);
    document.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      root.removeEventListener("keydown", tab);
      document.removeEventListener("selectionchange", schedule);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("click", clicked);
      document.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", moved);
    };
  }, [dismiss, viewport]);

  const add = () => {
    const root = viewport.current, state = useAppStore.getState();
    const session = state.sessions.find(item => item.id === sessionId);
    const owner = `session:${sessionId}`;
    const composer = root?.closest("section")?.querySelector<HTMLTextAreaElement>("textarea[data-draft-owner]");
    if (!selection || !root || !session || state.mainView !== "session" || state.selectedSessionId !== sessionId || state.selectedProjectId !== session.projectId || state.settingsOpen || state.paletteOpen || state.newSessionOpen || composer?.dataset.draftOwner !== owner || composer.disabled || !session.messages.some(message => message.id === selection.messageId)) { dismiss(); return; }
    const live = readTranscriptSelection(root, window.getSelection());
    if ((!live || live.messageId !== selection.messageId || live.text !== selection.text) && !popup.current?.contains(document.activeElement)) { dismiss(); return; }
    const next = appendTranscriptQuote(state.composerDrafts[owner] ?? "", selection.text);
    if (next === null) { setError(t("Draft exceeds the 64 KiB limit")); return; }
    state.setComposerDraft(owner, next);
    window.getSelection()?.removeAllRanges();
    dismiss();
    composer.focus({ preventScroll: true });
    composer.setSelectionRange(next.length, next.length);
  };

  // Asks about the passage in the side chat without touching this session's draft (ADR-049).
  const askSide = () => {
    const root = viewport.current, state = useAppStore.getState();
    const live = root ? readTranscriptSelection(root, window.getSelection()) : null;
    const text = live?.messageId === selection?.messageId ? live?.text ?? selection?.text : selection?.text;
    if (!text || state.selectedSessionId !== sessionId || state.mainView !== "session") { dismiss(); return; }
    window.getSelection()?.removeAllRanges();
    dismiss();
    void state.openSideChat(sessionId, text);
  };

  return <Popover open={selection !== null} onOpenChange={open => { if (!open) dismiss(); }}>
    <PopoverAnchor virtualRef={anchor} />
    <PopoverContent ref={popup} role="toolbar" aria-label={t("Selected text actions")} side="top" align="start" className="flex w-max min-w-0 flex-col p-1"
      onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
      onKeyDown={event => {
        if (event.key !== "Tab" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        const root = viewport.current;
        dismiss();
        const next = event.shiftKey ? root : root?.closest("section")?.querySelector<HTMLTextAreaElement>("textarea[data-draft-owner]");
        next?.focus({ preventScroll: true });
      }}
      onEscapeKeyDown={() => { window.getSelection()?.removeAllRanges(); dismiss(); }}>
      <InteractiveButton variant="ghost" onMouseDown={event => event.preventDefault()} onClick={add}>
        <MessageSquarePlus aria-hidden="true" size={16} />{t("Add to chat")}
      </InteractiveButton>
      <InteractiveButton variant="ghost" onMouseDown={event => event.preventDefault()} onClick={askSide}>
        <MessagesSquare aria-hidden="true" size={16} />{t("sideChat.ask")}
      </InteractiveButton>
      {error ? <p role="alert" className="max-w-64 px-2 py-1 ui-description text-danger">{error}</p> : null}
    </PopoverContent>
  </Popover>;
}

/** Memoized: streamed output re-renders the transcript, not this idle menu. */
export const TranscriptSelectionMenu = memo(TranscriptSelectionMenuView);
