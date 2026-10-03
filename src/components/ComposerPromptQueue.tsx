import { useId, useRef, useState } from "react";
import { ListOrdered, Pause, Play } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { useTranslation } from "@/i18n/use-translation";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { providerById } from "@/lib/provider-registry";

export function ComposerPromptQueue({ sessionId }: { sessionId: string }) {
  const t = useTranslation();
  const queue = useAppStore(state => state.promptQueues[sessionId]);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState(false);
  const labelId = useId();
  const card = useRef<HTMLElement>(null);
  const restoreFocus = (id?: string) => requestAnimationFrame(() => {
    const edit = [...(card.current?.querySelectorAll<HTMLButtonElement>("[data-queue-edit]") ?? [])].find(button => button.dataset.queueEdit === id && !button.disabled);
    (edit ?? card.current?.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? [...document.querySelectorAll<HTMLTextAreaElement>("textarea[data-draft-owner]")].find(area => area.dataset.draftOwner === `session:${sessionId}`))?.focus();
  });
  if (!queue?.items.length) return null;
  const store = () => useAppStore.getState();
  return <section ref={card} aria-label={t("queue.title")} className="mx-auto mb-2 w-full max-w-[var(--chat-column-width)] overflow-hidden rounded-2xl border border-border-subtle bg-background-2">
    <div className="flex items-center gap-2 px-3 py-2">
      <ListOrdered size={15} aria-hidden="true" className="text-text-muted" />
      <span className="flex-1 ui-control text-text-secondary" role="status">{t("queue.count", { count: queue.items.length })} · {t(queue.paused ? "queue.paused" : "queue.waiting")}</span>
      <InteractiveButton variant="toolbar" disabled={Boolean(queue.inFlight) || Boolean(editing)} onClick={() => queue.paused ? store().resumePromptQueue(sessionId) : store().pausePromptQueue(sessionId)}>
        {queue.paused ? <Play size={12} aria-hidden="true" /> : <Pause size={12} aria-hidden="true" />}{t(queue.paused ? "queue.resume" : "queue.pause")}
      </InteractiveButton>
    </div>
    {queue.paused && queue.reason ? <p className="px-3 pb-2 ui-description text-text-muted">{t(queue.reason)}</p> : null}
    <ol className="scroll-thin max-h-56 overflow-y-auto border-t border-border-subtle">
      {queue.items.map((item, index) => <li key={item.id} className="border-b border-border-subtle px-3 py-2 last:border-0">
        <div className="flex items-start gap-2">
          <span className="pt-1 ui-caption text-text-muted">{index + 1}</span>
          <div className="min-w-0 flex-1">
            {editing === item.id ? <form onSubmit={event => { event.preventDefault(); if (store().editQueuedPrompt(sessionId, item.id, text)) { setEditing(null); setError(false); restoreFocus(item.id); } else setError(true); }}>
              <label id={labelId} className="sr-only">{t("queue.edit")}</label>
              <textarea autoFocus aria-labelledby={labelId} value={text} onChange={event => { setText(event.target.value); setError(false); }} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setEditing(null); restoreFocus(item.id); } }} className="selectable min-h-20 w-full resize-y rounded-lg border border-border-default bg-background-1 p-2 ui-body text-text-primary" />
              {error ? <p role="alert" className="ui-description text-danger">{t("queue.invalid")}</p> : null}
              <div className="mt-1 flex gap-1"><InteractiveButton type="submit" variant="toolbar">{t("queue.save")}</InteractiveButton><InteractiveButton variant="toolbar" onClick={() => { setEditing(null); restoreFocus(item.id); }}>{t("queue.discardEdit")}</InteractiveButton></div>
            </form> : <p className="line-clamp-2 whitespace-pre-wrap break-words ui-body text-text-primary">{item.text || t("queue.attachmentsOnly")}</p>}
            <p className="mt-1 truncate ui-caption text-text-muted">{item.binding.model ?? item.binding.agent} · {t(item.execution?.approval === "full" ? "composer.fullAccess" : item.execution?.approval === "auto" ? "composer.autoReview" : providerById(item.binding.agent).approvalPolicy === "vendor" ? "composer.vendorApproval" : "composer.askApproval")}{item.context.planning ? ` · ${t("composer.planning")}` : ""}{item.context.debugging ? ` · ${t("composer.debugging")}` : ""}</p>
            {item.afterMessageId !== undefined && queue.inFlight !== item.id ? <p className="mt-1 ui-description text-text-muted">{t("queue.retryOnly")}</p> : null}
            {item.context.attachments.length ? <p className="truncate ui-caption text-text-muted">{item.context.attachments.map(file => file.name).join(", ")}</p> : null}
          </div>
          {editing !== item.id ? <div className="flex shrink-0 gap-1">
            <InteractiveButton variant="toolbar" data-queue-edit={item.id} disabled={queue.inFlight === item.id || item.afterMessageId !== undefined} aria-label={t("queue.editItem", { position: index + 1 })} onClick={() => { store().pausePromptQueue(sessionId); setEditing(item.id); setText(item.text); setError(false); }}>{t("queue.edit")}</InteractiveButton>
            <InteractiveButton variant="toolbar" disabled={queue.inFlight === item.id} aria-label={t("queue.cancelItem", { position: index + 1 })} onClick={() => { store().cancelQueuedPrompt(sessionId, item.id); restoreFocus(); }}>{t("queue.cancel")}</InteractiveButton>
          </div> : null}
        </div>
      </li>)}
    </ol>
    <p className="px-3 py-2 ui-caption text-text-muted">{t("queue.sessionOnly")}</p>
  </section>;
}
