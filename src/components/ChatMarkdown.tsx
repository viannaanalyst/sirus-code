import { FolderOpen, FileText, AppWindow, Copy, FolderSearch, ImagePlus } from "@/components/icons";
import { Children, createContext, isValidElement, memo, useContext, useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import { client } from "@/client";
import type { EditorId } from "@/client/types";
import { ContextMenu } from "@/components/arc/context-menu/context-menu";
import { ChatLink } from "@/components/ChatLink";
import { useTranslation } from "@/i18n/use-translation";
import { fileReference, localMediaKind } from "@/lib/chat-markdown";
import { parseMarkdownBlocks, type MarkdownBlocks } from "@/lib/markdown-blocks";
import { MATH_MAX, prepareMath } from "@/lib/markdown-math";
import { NO_REHYPE_PLUGINS, REMARK_PLUGINS, TAIL_REHYPE_PLUGINS, urlTransform } from "@/lib/markdown-pipeline";
import type { StreamFade } from "@/lib/use-stream-fade";
import { ReplyMedia } from "@/components/ReplyMedia";
import { StreamFadeText } from "@/components/StreamFadeText";
import { FileGlyph } from "@/components/FileGlyph";
import { MathFormula } from "@/components/MathFormula";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { CodeBlock } from "@/components/arc/code-block/code-block";
import { formatUnknownError } from "@/lib/format-error";
import { useAppStore } from "@/store/app-store";
import { GALLERY_EVENT } from "@/components/ImageLightbox";
import { readableCodexText } from "@/lib/codex-directives";
import { codeLinkUrl, isBareLinkText } from "@/lib/link-chips";
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

/** On the phone, file links open its Files screen instead of the desktop's editor pane. */
let phoneFileOpener: ((sessionId: string, path: string, directory: boolean) => void) | null = null;
export function setPhoneFileOpener(opener: typeof phoneFileOpener) {
  phoneFileOpener = opener;
  return () => { if (phoneFileOpener === opener) phoneFileOpener = null; };
}

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
  if (phoneFileOpener) { phoneFileOpener(owner.sessionId, path, kind === "dir"); return; }
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
      <FileGlyph name={name} directory={kind === "dir"} size={13} className="chat-file-ref-icon" />{children}
    </a>
  </ContextMenu>;
}

/** Links open by Chat behavior's rules (ADR-149); kept here for the surfaces that import it. */
export { openLink } from "@/components/ChatLink";

function openGallery(button: HTMLElement, url: string) {
  // A message (or another gallery scope, like a PR description) opens its own images together.
  const scope = button.closest("[data-message-id], [data-gallery-scope]") ?? document.body;
  const images = [...scope.querySelectorAll<HTMLImageElement>("img.chat-image")].map((image) => ({ src: image.src, name: image.alt || image.src }));
  window.dispatchEvent(new CustomEvent(GALLERY_EVENT, { detail: { images, index: Math.max(0, images.findIndex((image) => image.src === url || image.src === new URL(url, location.href).href)) } }));
}

/**
 * Images a reply links to on the Mac (ADR-085): the native side reads them, and every
 * image link of the message opens together in the gallery, starting at the one tapped.
 */
async function openReplyImages(anchor: HTMLElement, owner: Owner, url: string) {
  const scope = anchor.closest("[data-message-id]") ?? anchor.parentElement ?? document.body;
  const links = [...new Set([...scope.querySelectorAll<HTMLElement>("[data-reply-image]")].map((node) => node.dataset.replyImage ?? "").filter(Boolean))];
  if (!links.includes(url)) links.push(url);
  const loaded = await Promise.all(links.map((link) => client.replyImage(owner.sessionId, link).then(
    (src) => ({ link, src, name: link.split("/").pop() ?? link }),
    (error: unknown) => ({ link, error }),
  )));
  const images = loaded.flatMap((item) => "src" in item ? [{ src: item.src, name: item.name, link: item.link }] : []);
  const tapped = loaded.find((item) => item.link === url);
  if (tapped && "error" in tapped) { useAppStore.setState({ error: formatUnknownError(tapped.error) }); return; }
  window.dispatchEvent(new CustomEvent(GALLERY_EVENT, { detail: { images: images.map(({ src, name }) => ({ src, name })), index: Math.max(0, images.findIndex((image) => image.link === url)) } }));
}

/**
 * Lets a surface show some image URLs from another source (GitHub uploads read natively,
 * ADR-050): a string replaces the source, null shows a link instead, undefined keeps the URL.
 */
export const ChatImageSource = createContext<((url: string) => string | null | undefined) | null>(null);


/** The workspace a reply belongs to, for file links and local media; null outside a session. */
const OwnerContext = createContext<Owner | null>(null);
/** Set around the streaming reply's last block only: its last text fades in (ADR-119). */
const FadeContext = createContext<StreamFade | null>(null);

function plainText(children: ReactNode): string | null {
  const parts = Children.toArray(children);
  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : null;
}

/** A link or a local image in a reply: web links by Chat behavior's rules, files and media of the workspace. */
function ReplyLink({ url, children }: { url: string; children: ReactNode }) {
  const owner = useContext(OwnerContext);
  if (/^https?:\/\//i.test(url)) {
    // A link whose text is its own address reads as a chip; written text keeps its words after the icon.
    const only = plainText(children);
    return only !== null && isBareLinkText(only, url) ? <ChatLink url={url} chip /> : <ChatLink url={url}>{children}</ChatLink>;
  }
  const plainLink = () => {
    const reference = owner ? fileReference(url, owner.cwd) : null;
    const label = <span className="underline underline-offset-2">{children}</span>;
    return reference && owner ? <FileReference owner={owner} path={reference.path} line={reference.line} fallback={label}>{children}</FileReference> : label;
  };
  const media = owner ? localMediaKind(url) : null;
  if (owner && media) {
    // Local images and videos show inline (ADR-119); the link the reply wrote stays as the fallback.
    const link = media === "image"
      ? <a href="#" title={url} data-reply-image={url} className="chat-link chat-image-link" onClick={(event) => { event.preventDefault(); void openReplyImages(event.currentTarget, owner, url); }}>
        <ImagePlus size={13} aria-hidden="true" className="chat-file-ref-icon" />{children}
      </a>
      : plainLink();
    return <ReplyMedia sessionId={owner.sessionId} url={url} kind={media} caption={children} fallback={link} onOpen={(anchor) => void openReplyImages(anchor, owner, url)} />;
  }
  return plainLink();
}

function ReplyImage({ src, alt }: { src?: string; alt?: string }) {
  const imageSource = useContext(ChatImageSource);
  const url = src ?? "";
  if (!url) return <>{alt}</>;
  // Only https and base64 raster images are drawn; any other path stays a link (ADR-085).
  if (!/^https:\/\//i.test(url) && !/^data:image\//i.test(url)) return <ReplyLink url={url}>{alt || url}</ReplyLink>;
  const source = imageSource?.(url);
  if (source === null) return alt ? <ChatLink url={url}>{alt}</ChatLink> : <ChatLink url={url} chip />;
  const shown = source ?? url;
  // Images in a reply open together in the gallery, in the order they appear in the message.
  return <button type="button" className="chat-image-button" aria-label={alt || url} onClick={(event) => openGallery(event.currentTarget, shown)}>
    <img src={shown} alt={alt ?? ""} loading="lazy" decoding="async" className="chat-image" draggable={false} />
  </button>;
}

function InlineCode({ text }: { text: string }) {
  const owner = useContext(OwnerContext);
  const linked = codeLinkUrl(text);
  if (linked) return <ChatLink url={linked} chip />;
  const reference = owner ? fileReference(text, owner.cwd) : null;
  const code = <code className="chat-inline-code">{text}</code>;
  return reference && owner ? <FileReference owner={owner} path={reference.path} line={reference.line} fallback={code}>{text}</FileReference> : code;
}

function MarkdownCode({ className, children }: { className?: string; children?: ReactNode }) {
  const text = Children.toArray(children).join("");
  if (className?.includes("language-math")) return text.length <= MATH_MAX ? <MathFormula tex={text} /> : <code className="chat-inline-code">{`$${text}$`}</code>;
  return <InlineCode text={text} />;
}

const FencedCode = memo(CodeBlock);

/** A fenced block: display math, a diagram, or a code block with its header, language and copy button. */
function MarkdownPre({ children }: { children?: ReactNode }) {
  const streaming = useContext(FadeContext) !== null;
  const child = Children.toArray(children)[0];
  const props = isValidElement(child) ? child.props as { className?: string; children?: ReactNode } : null;
  const code = Children.toArray(props?.children).join("").replace(/\n$/, "");
  const className = props?.className ?? "";
  if (className.includes("language-math")) return code.length <= MATH_MAX ? <MathFormula tex={code} display /> : <FencedCode code={code} language="latex" animateChanges={false} />;
  const language = /(?:^|\s)language-(\S+)/.exec(className)?.[1] ?? "text";
  const block = language.toLowerCase() === "mermaid" && !streaming
    ? <MermaidDiagram source={code} />
    : <FencedCode code={code} language={language} maxLines={18} animateChanges={false} />;
  return <div className="chat-code">{block}</div>;
}

function SpanNode({ children, ...attributes }: HTMLAttributes<HTMLSpanElement> & { node?: unknown; "data-stream-tail"?: string }) {
  const fade = useContext(FadeContext);
  const text = plainText(children);
  // `node` is react-markdown's own prop, not a DOM attribute.
  const { "data-stream-tail": tail, node: _node, ...rest } = attributes;
  void _node;
  if (tail !== undefined && fade && text !== null) return <StreamFadeText text={text} fade={fade} />;
  return <span {...rest}>{children}</span>;
}

function heading(level: 1 | 2 | 3 | 4 | 5 | 6) {
  const Tag = `h${level}` as const;
  const className = level <= 2 ? "chat-heading ui-title" : "chat-heading font-semibold text-text-primary";
  return function Heading({ children }: { children?: ReactNode }) {
    return <Tag className={className}>{children}</Tag>;
  };
}

/** Task list checkboxes are drawn, not form controls: read-only and part of the sentence. */
function TaskBox({ checked, type }: { checked?: boolean; type?: string }) {
  if (type !== "checkbox") return null;
  return <span className="chat-task-box" role="checkbox" aria-checked={!!checked} aria-readonly="true" data-checked={checked ? "" : undefined} />;
}

function MarkdownTable({ children }: { children?: ReactNode }) {
  return <div className="chat-table-wrap scroll-thin"><table className="chat-table">{children}</table></div>;
}

/** One stable object: the elements never remount between deltas, since they never change identity. */
const COMPONENTS: Components = {
  a: ({ href, children }) => <ReplyLink url={href ?? ""}>{children}</ReplyLink>,
  img: ({ src, alt }) => <ReplyImage src={typeof src === "string" ? src : undefined} alt={alt} />,
  code: MarkdownCode,
  pre: MarkdownPre,
  span: SpanNode,
  input: TaskBox,
  table: MarkdownTable,
  // Link and file chips are menu wrappers (div), which a <p> cannot hold.
  p: ({ children }) => <div role="paragraph">{children}</div>,
  h1: heading(1), h2: heading(2), h3: heading(3), h4: heading(4), h5: heading(5), h6: heading(6),
};

/** One top-level block. A settled block has the same source on every delta, so it is not parsed or rendered again. */
const MarkdownBlock = memo(function MarkdownBlock({ source, tail }: { source: string; tail: boolean }) {
  const prepared = useMemo(() => prepareMath(source), [source]);
  return <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={tail ? TAIL_REHYPE_PLUGINS : NO_REHYPE_PLUGINS} components={COMPONENTS} urlTransform={urlTransform}>{prepared}</Markdown>;
});

/**
 * An assistant reply's prose as formatted text, with workspace files as links (ADR-179).
 * `fade` is set on the streaming reply's last prose: its last block fades the words that just arrived (ADR-119).
 */
export const ChatMarkdown = memo(function ChatMarkdown({ text, sessionId, cwd, fade = null }: { text: string; sessionId?: string; cwd?: string; fade?: StreamFade | null }) {
  // Codex's own directives (cited files, next steps) read as paths and reply choices (codex-directives).
  // While it streams, only the last block is scanned and parsed again; the settled ones keep their source.
  const parsed = useRef<MarkdownBlocks | null>(null);
  const blocks = useMemo(() => {
    parsed.current = parseMarkdownBlocks(parsed.current, readableCodexText(text));
    return parsed.current.blocks;
  }, [text]);
  const owner = useMemo(() => sessionId && cwd ? { sessionId, cwd } : null, [sessionId, cwd]);
  const last = blocks.length - 1;
  // Every block sits in the same wrapper type, so a block that stops being the last one is not remounted.
  return <OwnerContext.Provider value={owner}>
    <div className="chat-markdown">
      {blocks.map((source, index) => <FadeContext.Provider key={index} value={index === last ? fade : null}>
        <MarkdownBlock source={source} tail={index === last && fade !== null} />
      </FadeContext.Provider>)}
    </div>
  </OwnerContext.Provider>;
});
