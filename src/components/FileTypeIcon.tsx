import type { ReactElement } from "react";

/**
 * File-type icons for attachment chips (owner's pick "A"): a sheet in the type's colour with
 * its mark — PDF, HTML, CSV, Word, Excel, image — and a yellow folder. Drawn here, not brand logos.
 */
export type FileKind = "pdf" | "html" | "csv" | "docx" | "xlsx" | "img" | "text" | "folder";

const COLORS: Record<Exclude<FileKind, "folder">, string> = {
  pdf: "#e5383b", html: "#f26522", csv: "#1fa463", docx: "#2b6cde", xlsx: "#1d7a45", img: "#9b5de5", text: "#71717a",
};

export function fileKind(name: string, kind: "file" | "folder" = "file", mimeType?: string): FileKind {
  if (kind === "folder") return "folder";
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  // The extension names what the person sees (a Word "Web page" .doc is still a Word file);
  // the sniffed MIME type only decides when the extension says nothing.
  if (ext === "pdf") return "pdf";
  if (ext === "docx" || ext === "doc" || ext === "rtf" || ext === "odt") return "docx";
  if (ext === "xlsx" || ext === "xls" || ext === "ods" || ext === "numbers") return "xlsx";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (ext === "html" || ext === "htm") return "html";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "text/html") return "html";
  if (/^(png|jpe?g|gif|webp|heic|svg|bmp|tiff?)$/.test(ext) || mimeType?.startsWith("image/")) return "img";
  return "text";
}

/** Bytes as a short size label: "340 KB", "1.2 MB". */
export function formatFileSize(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const MARKS: Record<Exclude<FileKind, "folder">, ReactElement> = {
  pdf: <path d="M9.2 17.2c1.6-3.2 2.4-5.8 2.3-7.4-.1-1.4-1.6-1.4-1.6 0 0 2.2 3.4 6.2 5.6 6.6 1.3.2 1.4-1.2-.2-1.3-2-.2-5.3 1.1-6.1 2.1-.7.9.4 1.4 0 0z" fill="none" stroke="#fff" strokeWidth="1.1" strokeLinejoin="round" />,
  html: <path d="M9.6 12.2 7.6 14.4l2 2.2M14.4 12.2l2 2.2-2 2.2M12.8 11.4l-1.6 6" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />,
  csv: <path d="M7.5 11.5h9v6h-9zM7.5 14.5h9M11 11.5v6M13.8 11.5v6" fill="none" stroke="#fff" strokeWidth="1.1" />,
  xlsx: <><path d="M8.6 11.4l3.4 5.2M12 11.4l-3.4 5.2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /><path d="M13.4 12h3M13.4 14h3M13.4 16h3" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" /></>,
  docx: <><path d="M7.6 11.4l1.3 5.4 1.6-4.2 1.6 4.2 1.3-5.4" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /><path d="M14.4 12.6h2.2M14.4 15h2.2" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" /></>,
  img: <><circle cx="10" cy="12.4" r="1.2" fill="#fff" /><path d="M7.4 17.2l3-3 2 2 1.6-1.6 2.6 2.6z" fill="#fff" /></>,
  text: <path d="M8 12h8M8 14.5h8M8 17h5" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />,
};

export function FileTypeIcon({ kind, size = 18, className }: { kind: FileKind; size?: number; className?: string }) {
  if (kind === "folder") return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5h4.3l2 2h8.7A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" fill="#e9b20e" />
    <path d="M3 9h18v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" fill="#f5c842" />
  </svg>;
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path d="M6 2.5h8.5L19.5 7.5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1z" fill={COLORS[kind]} />
    <path d="M14.5 2.5v4a1 1 0 0 0 1 1h4z" fill="#fff" opacity=".45" />
    {MARKS[kind]}
  </svg>;
}
