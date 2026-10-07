import { FolderOpen, FileText, AppWindow, Copy, FolderSearch } from "@/components/icons/phosphor";
import { Fragment, memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { client } from "@/client";
import type { EditorId } from "@/client/types";
import { ContextMenu } from "@/components/arc/context-menu/context-menu";
import { useTranslation } from "@/i18n/use-translation";
import { fileReference, parseChatInline, parseChatMarkdown, type ChatBlock, type ChatInline } from "@/lib/chat-markdown";
import { fileIconFor, folderIconFor } from "@/lib/file-icons";
import { formatUnknownError } from "@/lib/format-error";
import { useAppStore } from "@/store/app-store";
import { GALLERY_EVENT } from "@/components/ImageLightbox";
import "@/styles/chat-markdown.css";

type RefKind = "file" | "dir" | null;
interface Owner { sessionId: string; cwd: string }

// Workspace checks: one native lookup per path and session. A miss is retried
// after a while, since replies often name a file just before creating it.
const checks = new Map<string, { at: number; kind: Promise<RefKind>; settled?: RefKind }>();
// One shallow root listing per session answers every bare filename for a while.
const roots = new Map<string, { at: number; listing: ReturnType<typeof client.workspaceFiles> }>();
function rootListing(sessionId: string) {
  const known = roots.get(sessionId);
  if (known && Date.now() - known.at < 15_000) return known.listing;
  const listing = client.workspaceFiles({ projectId: null, sessionId }, "");
  roots.set(sessionId, { at: Date.now(), listing });
  if (roots.size > 32) roots.delete(roots.keys().next().value!);
  return listing;
}
function checkReference(sessionId: string, path: string): Promise<RefKind> {
  const key = `${sessionId}\0${path}`;
  const known = checks.get(key);
  if (known && !(known.settled === null && Date.now() - known.at > 15_000)) return known.kind;
  const entry: { at: number; kind: Promise<RefKind>; settled?: RefKind } = { at: Date.now(), kind: Promise.resolve(null) };
  // A bare name would start a recursive workspace search; only a root entry can match it exactly.
  const lookup = path.includes("/") ? client.workspaceFiles({ projectId: null, sessionId }, path) : rootListing(sessionId);
  entry.kind = lookup
    .then((result) => {
      const match = result.entries.find((item) => item.path === path);
      return match ? (match.isDir ? "dir" : "file") : null;
    })
    .catch(() => null)
    .then((kind) => { entry.settled = kind; return kind; });
  checks.set(key, entry);
  if (checks.size > 2000) checks.delete(checks.keys().next().value!);
  return entry.kind;
}

function useReference(owner: Owner | null, path: string | null): RefKind {
  const key = owner && path ? `${owner.sessionId}\0${path}` : "";
  const [state, setState] = useState<{ key: string; kind: RefKind }>({ key: "", kind: null });
  useEffect(() => {
    if (!owner || !path) return;
    let alive = true;
    void checkReference(owner.sessionId, path).then((kind) => { if (alive) setState({ key: `${owner.sessionId}\0${path}`, kind }); });
    return () => { alive = false; };
  }, [owner, path]);
  return state.key === key ? state.kind : null;
}

let editorsRequested = false;

/** The external editor ⌘-click opens: the first installed of Cursor, VS Code, Xcode. */
function externalEditor(): { id: EditorId; name: string } | null {
  const editors = useAppStore.getState().editors ?? [];
  return editors.find((editor) => editor.installed && ["cursor", "vscode", "xcode"].includes(editor.id)) ?? null;
}

/** Editor and external openers take the absolute path inside the session workspace. */
const absolute = (owner: Owner, path: string) => `${owner.cwd.replace(/\/$/, "")}/${path}`;

function openReference(owner: Owner, path: string, kind: RefKind, external: boolean) {
  const store = useAppStore.getState();
  const fail = (error: unknown) => useAppStore.setState({ error: formatUnknownError(error) });
  if (external) {
    const editor = externalEditor();
    if (editor) { void client.openInEditor(owner.sessionId, editor.id, absolute(owner, path)).catch(fail); return; }
  }
  const open = () => kind === "dir" ? store.openDockPane("files") : store.openDockPane("editor", absolute(owner, path));
  if (store.selectedSessionId === owner.sessionId) open();
  else void store.selectSession(owner.sessionId).then(open);
}

/** `fallback` shows until (or unless) the workspace confirms the path. */
function FileReference({ owner, path, line, children, fallback }: { owner: Owner; path: string; line: number | null; children: ReactNode; fallback: ReactNode }) {
  const t = useTranslation();
  const kind = useReference(owner, path);
  const editor = useAppStore((state) => (state.editors ?? []).find((item) => item.installed && ["cursor", "vscode", "xcode"].includes(item.id)) ?? null);
  useEffect(() => { if (!editorsRequested) { editorsRequested = true; void useAppStore.getState().loadEditors(); } }, []);
  if (!kind) return <>{fallback}</>;
  const name = path.split("/").pop() ?? path;
  const icon = kind === "dir" ? folderIconFor(name, false) : fileIconFor(name);
  const Icon = icon.Icon;
  const title = [t(kind === "dir" ? "fileRef.openFolder" : "fileRef.open", { path }), editor && kind === "file" ? t("fileRef.external", { editor: editor.name }) : null].filter(Boolean).join(" · ");
  const items = [
    { id: "open", label: t(kind === "dir" ? "fileRef.showFiles" : "fileRef.openHere"), icon: kind === "dir" ? <FolderOpen size={15} /> : <FileText size={15} />, onSelect: () => openReference(owner, path, kind, false) },
    ...(editor && kind === "file" ? [{ id: "external", label: t("fileRef.openIn", { editor: editor.name }), icon: <AppWindow size={15} />, onSelect: () => openReference(owner, path, kind, true) }] : []),
    { id: "copy", label: t("fileRef.copy"), icon: <Copy size={15} />, group: "path", onSelect: () => void navigator.clipboard.writeText(path) },
    { id: "reveal", label: t("fileRef.reveal"), icon: <FolderSearch size={15} />, group: "path", onSelect: () => void client.openInEditor(owner.sessionId, "finder", absolute(owner, path)).catch(() => undefined) },
  ];
  return <ContextMenu inline activation="context-only" label={t("fileRef.actions", { path })} items={items}>
    {/* A link, not a button: it wraps with the sentence instead of breaking before punctuation. */}
    <a href={`#${path}`} title={title} data-line={line ?? undefined} className="chat-file-ref" onContextMenu={() => requestAnimationFrame(() => window.getSelection()?.removeAllRanges())} onClick={(event) => { event.preventDefault(); openReference(owner, path, kind, event.metaKey && kind === "file"); }}>
      <Icon size={13} aria-hidden="true" style={{ color: icon.color }} className="chat-file-ref-icon" />{children}
    </a>
  </ContextMenu>;
}

/** GitHub PR/issue links open the Pull requests page when Chat behavior asks for it (⌘-click: browser). */
function openLink(url: string, external: boolean) {
  const store = useAppStore.getState();
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:pull|issues)\/(\d+)(?:[/?#]|$)/i.exec(url);
  if (match && !external && store.settings.githubLinksInApp) {
    useAppStore.setState({ pullsSelection: `${match[1]}#${match[2]}` });
    store.setMainView("pulls");
    return;
  }
  void client.openExternalUrl(url).catch(() => void navigator.clipboard.writeText(url));
}

function openGallery(button: HTMLElement, url: string) {
  const scope = button.closest("[data-message-id]") ?? document.body;
  const images = [...scope.querySelectorAll<HTMLImageElement>("img.chat-image")].map((image) => ({ src: image.src, name: image.alt || image.src }));
  window.dispatchEvent(new CustomEvent(GALLERY_EVENT, { detail: { images, index: Math.max(0, images.findIndex((image) => image.src === url || image.src === new URL(url, location.href).href)) } }));
}

function Inline({ nodes, owner }: { nodes: ChatInline[]; owner: Owner | null }): ReactNode {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "text": return <Fragment key={index}>{node.text}</Fragment>;
      case "bold": return <strong key={index} className="font-semibold text-text-primary"><Inline nodes={node.children} owner={owner} /></strong>;
      case "italic": return <em key={index}><Inline nodes={node.children} owner={owner} /></em>;
      case "strike": return <s key={index}><Inline nodes={node.children} owner={owner} /></s>;
      case "code": {
        const reference = owner ? fileReference(node.text, owner.cwd) : null;
        const code = <code className="chat-inline-code">{node.text}</code>;
        return reference && owner ? <FileReference key={index} owner={owner} path={reference.path} line={reference.line} fallback={code}>{node.text}</FileReference> : <Fragment key={index}>{code}</Fragment>;
      }
      case "image":
        // Images in a reply open together in the gallery, in the order they appear in the message.
        return <button key={index} type="button" className="chat-image-button" aria-label={node.alt || node.url} onClick={(event) => openGallery(event.currentTarget, node.url)}>
          <img src={node.url} alt={node.alt} loading="lazy" className="chat-image" draggable={false} />
        </button>;
      case "link": {
        if (/^https?:\/\//i.test(node.url)) {
          return <a key={index} href="#" title={node.url} className="chat-link" onClick={(event) => { event.preventDefault(); openLink(node.url, event.metaKey || event.ctrlKey); }}><Inline nodes={node.children} owner={owner} /></a>;
        }
        const reference = owner ? fileReference(node.url, owner.cwd) : null;
        const label = <span className="underline underline-offset-2"><Inline nodes={node.children} owner={owner} /></span>;
        return reference && owner ? <FileReference key={index} owner={owner} path={reference.path} line={reference.line} fallback={label}><Inline nodes={node.children} owner={owner} /></FileReference> : <Fragment key={index}>{label}</Fragment>;
      }
    }
  });
}

/** One parsed block. While a reply streams only its last block changes, so earlier
 * blocks skip inline parsing and reconciliation (compared by their source). */
const MarkdownBlock = memo(function MarkdownBlock({ block, owner }: { block: ChatBlock; source: string; owner: Owner | null }) {
  const inline = (value: string) => <Inline nodes={parseChatInline(value)} owner={owner} />;
  switch (block.kind) {
    case "heading": return <div role="heading" aria-level={block.level} className={block.level <= 2 ? "chat-heading ui-title" : "chat-heading font-semibold text-text-primary"}>{inline(block.text)}</div>;
    case "paragraph": return <div className="whitespace-pre-wrap">{inline(block.text)}</div>;
    case "quote": return <div className="chat-quote whitespace-pre-wrap">{inline(block.text)}</div>;
    case "rule": return <hr className="border-border-subtle" />;
    case "list": return <div role="list" className="chat-list">
      {block.items.map((item, position) => <div key={position} role="listitem" className="chat-list-item" style={{ paddingInlineStart: `${item.depth * 1.25}rem` }}>
        <span className="chat-list-marker" aria-hidden="true">{item.task !== null ? (item.task ? "☑" : "☐") : item.ordered ? `${item.number}.` : item.depth % 2 ? "◦" : "•"}</span>
        <div className="min-w-0 flex-1 whitespace-pre-wrap">{inline(item.text)}</div>
      </div>)}
    </div>;
    case "table": return <div className="chat-table-wrap scroll-thin"><table className="chat-table">
      <thead><tr>{block.header.map((cell, column) => <th key={column} style={{ textAlign: block.align[column] ?? undefined }}>{inline(cell)}</th>)}</tr></thead>
      <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{block.header.map((_, column) => <td key={column} style={{ textAlign: block.align[column] ?? undefined }}>{inline(row[column] ?? "")}</td>)}</tr>)}</tbody>
    </table></div>;
  }
}, (previous, next) => previous.source === next.source && previous.owner === next.owner);

/** An assistant reply's prose as formatted text, with workspace files as links. */
export const ChatMarkdown = memo(function ChatMarkdown({ text, sessionId, cwd }: { text: string; sessionId?: string; cwd?: string }) {
  const blocks = useMemo(() => parseChatMarkdown(text).map((block) => ({ block, source: JSON.stringify(block) })), [text]);
  const owner = useMemo(() => sessionId && cwd ? { sessionId, cwd } : null, [sessionId, cwd]);
  return <div className="chat-markdown">
    {blocks.map(({ block, source }, index) => <MarkdownBlock key={index} block={block} source={source} owner={owner} />)}
  </div>;
});
