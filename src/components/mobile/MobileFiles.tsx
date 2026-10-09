import { useEffect, useState } from "react";
import type { FileEntry } from "@/client/types";
import { client } from "@/client";
import { ChevronLeft, ChevronRight, LoaderCircle } from "@/components/icons/phosphor";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { useTranslation } from "@/i18n/use-translation";
import { isLocalImageLink } from "@/lib/chat-markdown";
import { FileGlyph } from "@/components/FileGlyph";
import { formatUnknownError } from "@/lib/format-error";
import { sortEntries } from "@/lib/mobile";
import { useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";

type Preview = { name: string; kind: "text" | "markdown"; content: string } | { name: string; kind: "image"; src: string } | { name: string; kind: "binary" };

/**
 * The session's workspace on the phone (ADR-086): browse folders and preview files —
 * code and text as monospace, Markdown formatted, images as images. Read-only.
 */
export function MobileFiles({ sessionId, navigation }: { sessionId: string; navigation: MobileNavigation }) {
  const t = useTranslation();
  const session = useAppStore((state) => state.sessions.find((item) => item.id === sessionId));
  const root = session?.worktree.path ?? "";
  const [trail, setTrail] = useState<string[]>([]);
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dir = trail.at(-1);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    void client.listDir(sessionId, dir).then((items) => { if (!cancelled) setEntries(sortEntries(items)); }, (reason: unknown) => { if (!cancelled) { setEntries([]); setError(formatUnknownError(reason)); } });
    return () => { cancelled = true; };
  }, [sessionId, dir]);

  const openFile = async (entry: FileEntry) => {
    setPreview({ name: entry.name, kind: "text", content: "" });
    try {
      if (isLocalImageLink(entry.name)) { setPreview({ name: entry.name, kind: "image", src: await client.replyImage(sessionId, entry.path) }); return; }
      const file = await client.readTextFile(sessionId, entry.path);
      setPreview(file.binary ? { name: entry.name, kind: "binary" } : { name: entry.name, kind: /\.(md|markdown)$/i.test(entry.name) ? "markdown" : "text", content: file.content });
    } catch (reason) {
      setPreview(null);
      setError(formatUnknownError(reason));
    }
  };
  const relative = (path: string | undefined) => !path ? (session?.worktree.branch ?? "") : path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  const back = () => { if (preview) setPreview(null); else if (trail.length) setTrail(trail.slice(0, -1)); else navigation.back(); };

  return <div className="mobile-page">
    <header className="mobile-bar">
      <button type="button" className="mobile-icon-button" aria-label={t("mobile.back")} onClick={back}><ChevronLeft size={18} aria-hidden="true" /></button>
      <div className="mobile-bar-title"><h1>{preview?.name ?? t("mobile.files")}</h1><p>{preview ? relative(dir) : relative(dir) || session?.title}</p></div>
    </header>
    {preview ? <div className="mobile-file-preview">
      {preview.kind === "image" ? <img src={preview.src} alt={preview.name} className="mobile-file-image" />
        : preview.kind === "binary" ? <p className="mobile-empty">{t("mobile.binaryFile")}</p>
        : preview.kind === "markdown" ? <div className="mobile-file-markdown"><MarkdownPreview source={preview.content} /></div>
        : preview.content ? <pre className="mobile-file-text selectable">{preview.content}</pre>
        : <p className="mobile-empty"><LoaderCircle size={15} className="animate-spin" aria-hidden="true" /></p>}
    </div> : <div className="mobile-scroll">
      {error ? <p role="alert" className="mobile-help text-danger">{error}</p> : null}
      {entries === null ? <p className="mobile-empty"><LoaderCircle size={15} className="animate-spin" aria-hidden="true" /></p>
        : entries.length ? <div className="mobile-list mobile-section">
          {entries.map((entry) => {
            return <button key={entry.path} type="button" className="mobile-file" onClick={() => entry.isDir ? setTrail([...trail, entry.path]) : void openFile(entry)}>
              <FileGlyph name={entry.name} directory={entry.isDir} size={18} />
              <span className="mobile-file-name">{entry.name}</span>
              {entry.isDir ? <ChevronRight size={15} className="text-text-muted" aria-hidden="true" /> : null}
            </button>;
          })}
        </div> : <p className="mobile-empty">{t("mobile.emptyFolder")}</p>}
    </div>}
  </div>;
}
