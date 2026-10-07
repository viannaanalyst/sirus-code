import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Code, Copy, Eye, Trash2, X } from "@/components/icons/phosphor";
import type { PromptAttachment } from "@/client/types";
import { CodeBlock } from "@/components/arc/code-block/code-block";
import { DocumentBody } from "@/components/DocumentReader";
import { HtmlPage } from "@/components/HtmlPreview";
import { useTranslation } from "@/i18n/use-translation";
import { canReadDocument } from "@/lib/document-reader";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { useAppStore } from "@/store/app-store";

const isHtml = (file: PromptAttachment) => /\.html?$/i.test(file.name) || file.mimeType === "text/html";
const isCsv = (file: PromptAttachment) => /\.csv$/i.test(file.name) || file.mimeType === "text/csv";
const sourceLanguage = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "text";
const formatSize = (bytes?: number) => bytes === undefined ? "" : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;


/**
 * A draft attachment opened over the app (after T3 Code): "Draft › name  size" with a
 * page/source toggle, copy, remove from the draft and close. PDFs, Word, spreadsheets and
 * CSV render as documents, HTML runs as a page, other text shows as source.
 */
export function AttachmentModal() {
  const t = useTranslation();
  const reduced = useMotionPreferences();
  const open = useAppStore((state) => state.attachmentModal);
  const file = useAppStore((state) => open ? state.composerContexts[open.scope]?.attachments.find((item) => item.id === open.attachmentId) ?? null : null);
  const close = () => useAppStore.getState().closeAttachmentModal();
  const [source, setSource] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  if ((file?.id ?? null) !== shown) { setShown(file?.id ?? null); setSource(false); }
  useEffect(() => {
    if (!file) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); useAppStore.getState().closeAttachmentModal(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [file]);
  const text = file?.content ?? "";
  const canToggle = Boolean(file && text && (isHtml(file) || isCsv(file)));
  const remove = () => {
    if (!open || !file) return;
    const state = useAppStore.getState(), context = state.composerContexts[open.scope];
    if (context) state.setComposerContext(open.scope, { ...context, attachments: context.attachments.filter((item) => item.id !== file.id) });
    close();
  };
  const body = !file ? null
    : source || (!canReadDocument(file) && !isHtml(file)) ? <div className="attachment-modal-source"><CodeBlock code={text} language={isHtml(file) ? "html" : sourceLanguage(file.name)} animateChanges={false} /></div>
    : isHtml(file) ? <HtmlPage source={text} className="attachment-modal-page" />
    : <DocumentBody owner={file.owner ?? open!.scope} attachmentId={file.id} active zoom={1} />;
  return createPortal(<AnimatePresence>
    {file && open ? <motion.div key="attachment-modal" className="attachment-modal-backdrop" onClick={close}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.16 }}>
      <motion.section role="dialog" aria-modal="true" aria-label={file.name} className="attachment-modal" onClick={(event) => event.stopPropagation()}
        initial={reduced ? false : { opacity: 0, scale: 0.97, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, scale: 0.98 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
        <header className="attachment-modal-header">
          <span className="ui-control text-text-muted">{t("attachment.draft")}</span>
          <ChevronRight size={12} aria-hidden="true" className="text-text-muted" />
          <span className="min-w-0 truncate ui-control font-medium text-text-primary" title={file.name}>{file.name}</span>
          <span className="ui-caption text-text-muted">{formatSize(file.size)}</span>
          <div className="ml-auto flex items-center gap-0.5">
            {canToggle ? <button type="button" className="attachment-modal-action" aria-pressed={source} aria-label={t(source ? "attachment.showPage" : "attachment.showSource")} title={t(source ? "attachment.showPage" : "attachment.showSource")} onClick={() => setSource(!source)}>{source ? <Eye size={15} aria-hidden="true" /> : <Code size={15} aria-hidden="true" />}</button> : null}
            {text ? <button type="button" className="attachment-modal-action" aria-label={t("attachment.copy")} title={t("attachment.copy")} onClick={() => void navigator.clipboard.writeText(text)}><Copy size={15} aria-hidden="true" /></button> : null}
            <button type="button" className="attachment-modal-action" aria-label={t("composer.removeAttachment")} title={t("composer.removeAttachment")} onClick={remove}><Trash2 size={15} aria-hidden="true" /></button>
            <button type="button" className="attachment-modal-action" aria-label={t("common.close")} title={t("common.close")} onClick={close}><X size={15} aria-hidden="true" /></button>
          </div>
        </header>
        <div className="attachment-modal-body">{body}</div>
      </motion.section>
    </motion.div> : null}
  </AnimatePresence>, document.body);
}
