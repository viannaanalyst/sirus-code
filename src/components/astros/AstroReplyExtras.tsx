import { useEffect, useState, useSyncExternalStore } from "react";
import type { AstroDocument, Message } from "@/client/types";
import { client } from "@/client";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { SessionCard } from "@/components/astros/AstroCard";
import { ChevronRight, FileText, MessagesSquare, Trash2 } from "@/components/icons/phosphor";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { StatusIndicator } from "@/primitives/StatusIndicator";
import { selectSessionsMeta, useAppStore } from "@/store/app-store";

/**
 * What an Astro reply produced besides its text (ADR-088): the documents it wrote or
 * revised, as cards that open a reader, and the sessions it started, behind a Sessions
 * control with each one's provider, model, project and status.
 */
export function AstroReplyExtras({ message }: { message: Message }) {
  const documents = message.documents ?? [];
  const launched = message.launched ?? [];
  if (!documents.length && !launched.length) return null;
  return <div className="astro-reply-extras">
    {documents.map((id) => <DocumentCard key={id} id={id} />)}
    {launched.length ? <LaunchedSessions ids={launched} /> : null}
  </div>;
}

const stamp = (at: string) => new Date(at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// One shared cache, so every card and reader of a document refreshes together.
const cache = new Map<string, AstroDocument | "missing">();
const listeners = new Set<() => void>();
let version = 0;
let watching = false;
const notify = () => { version += 1; for (const listener of listeners) listener(); };

function load(id: string) {
  void client.astroDocument<AstroDocument>({ type: "read", id }).then(
    (document) => { cache.set(id, document); notify(); },
    () => { cache.set(id, "missing"); notify(); },
  );
}

function watch() {
  if (watching) return;
  watching = true;
  void client.onAstroDocumentChanged((id) => { if (cache.has(id)) load(id); });
}

function useDocument(id: string): AstroDocument | "missing" | null {
  useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => version);
  useEffect(() => { watch(); if (!cache.has(id)) load(id); }, [id]);
  return cache.get(id) ?? null;
}

function DocumentCard({ id }: { id: string }) {
  const t = useTranslation();
  const document = useDocument(id);
  const [open, setOpen] = useState(false);
  if (document === "missing") return null;
  return <>
    <button type="button" className="astro-card astro-card-link astro-document-card" disabled={!document} onClick={() => setOpen(true)}>
      <FileText size={16} className="text-text-muted" />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate ui-control text-text-primary">{document?.title ?? t("common.loading")}</span>
        <span className="block truncate ui-caption text-text-muted">{document ? t("astros.document.updated", { time: stamp(document.updatedAt) }) : " "}</span>
      </span>
      <ChevronRight size={13} className="text-text-muted" />
    </button>
    {document ? <DocumentReader document={document} open={open} onClose={() => setOpen(false)} /> : null}
  </>;
}

function DocumentReader({ document, open, onClose }: { document: AstroDocument; open: boolean; onClose: () => void }) {
  const t = useTranslation();
  const [confirm, setConfirm] = useState(false);
  return <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <DialogContent title={document.title} description={t("astros.document.updated", { time: stamp(document.updatedAt) })} className="astro-document-reader">
      <div className="astro-document-body"><MarkdownPreview source={document.markdown} /></div>
      <div className="flex items-center justify-end gap-2">
        <InteractiveButton variant="toolbar" className="text-danger" onClick={() => setConfirm(true)}><Trash2 size={13} />{t("astros.document.delete")}</InteractiveButton>
        <CopyButton value={document.markdown} label={t("astros.document.copy")} />
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} destructive
        title={t("astros.document.deleteTitle", { title: document.title })} description={t("astros.document.deleteBody")}
        confirmLabel={t("astros.document.delete")} cancelLabel={t("common.cancel")}
        onConfirm={async () => {
          try { await client.astroDocument({ type: "delete", id: document.id, confirm: true }); cache.set(document.id, "missing"); notify(); onClose(); }
          catch (reason) { useAppStore.setState({ error: formatUnknownError(reason) }); }
          setConfirm(false);
        }} />
    </DialogContent>
  </Dialog>;
}

function LaunchedSessions({ ids }: { ids: string[] }) {
  const t = useTranslation();
  const sessions = useAppStore((state) => selectSessionsMeta(state));
  const known = ids.map((id) => sessions.find((session) => session.id === id)).filter((session) => session !== undefined);
  const active = known.filter((session) => ["starting", "running", "waiting"].includes(session.status)).length;
  return <Popover>
    <PopoverTrigger asChild>
      <button type="button" className="astro-sessions-trigger ui-caption">
        <MessagesSquare size={13} />
        {t("astros.launched", { count: ids.length })}
        {active ? <StatusIndicator status="running" /> : null}
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="astro-sessions-panel">
      {ids.map((id) => <SessionCard key={id} id={id} />)}
    </PopoverContent>
  </Popover>;
}
