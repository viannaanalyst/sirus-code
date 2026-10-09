import { memo, useMemo, useSyncExternalStore } from "react";
import { fileIconFor, folderIconFor } from "@/lib/file-icons";
import { materialFileIcon, type MaterialIconPack } from "@/lib/material-file-icon";

/**
 * File and folder icons from the Material Icon Theme (as in VS Code and MonoCode). The pack
 * inlines every glyph (~1 MB), so it loads after first paint; until then the row shows the
 * small drawn icon from `file-icons.ts` at the same size, so nothing reflows when it lands.
 */
let pack: MaterialIconPack | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!pack && !loading) {
    loading = import("react-material-icon-theme").then((module) => {
      pack = module;
      listeners.forEach((listener) => listener());
    }, () => { loading = null; });
  }
  return () => { listeners.delete(onChange); };
}
const snapshot = () => pack;

export const FileGlyph = memo(function FileGlyph({ name, directory = false, open = false, size = 14, className }: {
  name: string; directory?: boolean; open?: boolean; size?: number; className?: string;
}) {
  const icons = useSyncExternalStore(subscribe, snapshot, snapshot);
  const svg = icons ? icons.getIconSvg(directory ? icons.getFolderIcon({ folderName: name, isOpen: open, isRoot: false }) : materialFileIcon(icons, name)) ?? "" : "";
  const markup = useMemo(() => ({ __html: svg }), [svg]);
  if (!svg) {
    const spec = directory ? folderIconFor(name, open) : fileIconFor(name);
    return <spec.Icon size={size} style={{ color: spec.color }} className={className ? `shrink-0 ${className}` : "shrink-0"} aria-hidden="true" />;
  }
  return <span aria-hidden="true" className={className ? `material-icon ${className}` : "material-icon"} style={{ width: size, height: size }} dangerouslySetInnerHTML={markup} />;
});
