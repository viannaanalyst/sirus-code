import { ChevronRight, Pin, X } from "@/components/icons/phosphor";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Session } from "@/client/types";
import { Textarea } from "@/components/arc/textarea/textarea";
import { useTranslation } from "@/i18n/use-translation";
import { CONTEXT_TEXT_LIMIT, pinnedContextMessages } from "@/lib/context-text";
import { useAppStore } from "@/store/app-store";
import "@/styles/environment-context.css";

export function EnvironmentContextSections({ session, projectId }: { session: Session; projectId: string }) {
  const t = useTranslation();
  const showPinned = useAppStore(state => state.settings.showEnvironmentPinned);
  const showNotes = useAppStore(state => state.settings.showEnvironmentNotepad);
  const showInstructions = useAppStore(state => state.settings.showEnvironmentInstructions);
  const jump = useAppStore(state => state.jumpToMessage);
  const pin = useAppStore(state => state.setMessagePinned);
  const messages = pinnedContextMessages(session);
  return <>
    {showPinned && <ContextSection key={`pins:${session.id}`} label={t("Pinned messages")} initiallyOpen={messages.length > 0}>
      {messages.length ? <ul className="context-pin-list">{messages.map(message => <li key={message.id} className="context-pin-row">
        <Pin size={12} aria-hidden="true" className="shrink-0 text-text-muted" />
        <button type="button" className="context-pin-jump ui-description" onClick={() => jump(session.id, message.id)} aria-label={t("Jump to pinned message: {text}", { text: message.content.slice(0, 120) })}>
          {message.content.slice(0, 140).replace(/\s+/g, " ")}{message.content.length > 140 ? "…" : ""}
        </button>
        <button type="button" className="context-pin-remove" aria-label={t("Unpin message")} onClick={() => void pin(session.id, message.id, false)}><X size={12} aria-hidden="true" /></button>
      </li>)}</ul> : <p className="context-empty ui-description">{t("Pin an assistant response to find it here.")}</p>}
    </ContextSection>}
    {showInstructions && <ContextTextSection key={`project:${projectId}`} ownerKey={`project:${projectId}`} label={t("Project instructions")} placeholder={t("Conventions, architecture notes and project references…")} />}
    {showNotes && <ContextTextSection key={`session:${session.id}`} ownerKey={`session:${session.id}`} label={t("Notepad")} placeholder={t("Ideas, reminders and next steps for this session…")} />}
  </>;
}

function ContextSection({ label, children, initiallyOpen = false }: { label: string; children: ReactNode; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return <details className="environment-context-section" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="ui-control"><ChevronRight size={12} aria-hidden="true" /><span>{label}</span></summary>
    <div className="environment-context-content">{children}</div>
  </details>;
}

function ContextTextSection({ ownerKey, label, placeholder }: { ownerKey: string; label: string; placeholder: string }) {
  const t = useTranslation();
  const value = useAppStore(state => state.contextTexts[ownerKey] ?? "");
  const status = useAppStore(state => state.contextTextStatus[ownerKey]);
  const edit = useAppStore(state => state.setContextText);
  const flush = useAppStore(state => state.flushContextText);
  const hintId = useId();
  const errorId = useId();
  const dirty = useRef(false);
  useEffect(() => {
    const edits = dirty;
    return () => { if (edits.current) void useAppStore.getState().flushContextText(ownerKey); };
  }, [ownerKey]);
  return <ContextSection label={label} initiallyOpen={!!value}>
    <div className="environment-context-field">
      <Textarea hideLabel label={label} variant="plain" className="environment-context-input ui-description" rows={4} maxLength={CONTEXT_TEXT_LIMIT}
        value={value} placeholder={placeholder} aria-describedby={status?.error ? `${hintId} ${errorId}` : hintId} aria-invalid={!!status?.error}
        onChange={event => { dirty.current = true; void edit(ownerKey, event.currentTarget.value); }}
        onBlur={() => { if (dirty.current) { dirty.current = false; void flush(ownerKey); } }} />
      <div id={hintId} className="environment-context-status ui-caption">
        <span>{status?.saving ? t("Saving…") : t("Autosave")}</span>
        <span className="tabular-nums">{value.length.toLocaleString()} / {CONTEXT_TEXT_LIMIT.toLocaleString()}</span>
      </div>
      {status?.error && <div className="environment-context-error ui-caption"><p id={errorId} role="alert">{t(status.error)}</p><button type="button" disabled={status.saving} onClick={() => void flush(ownerKey)}>{t("common.retry")}</button></div>}
    </div>
  </ContextSection>;
}
