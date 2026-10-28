#!/usr/bin/env node
/**
 * Generates src/components/icons/solar-data.ts: only the Solar icons the app uses (ADR-177).
 *
 *   node scripts/build-solar-icons.mjs [path-to-zeron-icons-dir]
 *
 * Sources, in order of preference:
 *   1. Zeron's adjusted Solar SVGs (zeronsh/comet on GitHub, MIT), crates/ui/assets/icons/<name>.svg
 *   2. `<name>-linear` from @iconify-json/solar (480 Design, CC BY 4.0)
 * The active/pinned (`fill`) look is `<name>-bold` from @iconify-json/solar; icons without one stay linear.
 * Every stroke width is normalized to 1.7. The Zeron directory is only read as data, never executed.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const zeronDir = resolve(process.argv[2] ?? "/tmp/zeron-icons/crates/ui/assets/icons");
const require = createRequire(import.meta.url);
const solar = JSON.parse(readFileSync(require.resolve("@iconify-json/solar/icons.json"), "utf8")).icons;
const STROKE = "1.7";

/**
 * Reviewed mapping: exported icon name (Lucide-era, kept so call sites do not change) -> Solar icon name.
 * A name with a Zeron SVG uses Zeron's drawing; otherwise Solar `<name>-linear`.
 */
export const ICON_MAP = {
  AlertCircle: "danger-circle", AlertTriangle: "danger-triangle", AppWindow: "window-frame",
  ArrowDown: "arrow-down", ArrowLeft: "arrow-left", ArrowRight: "arrow-right", ArrowUp: "arrow-up",
  ArrowUpDown: "sort-vertical", ArrowUpFromLine: "arrow-up-from-line", Bell: "bell", Bold: "text-bold",
  Bot: "bot", Box: "box", Bug: "bug", CalendarDays: "calendar", Camera: "camera", Check: "check",
  CheckCircle2: "check-circle", ChevronDown: "alt-arrow-down", ChevronLeft: "alt-arrow-left",
  ChevronRight: "alt-arrow-right", ChevronUp: "alt-arrow-up", ChevronsDownUp: "collapse-arrows",
  ChevronsUpDown: "expand-arrows", CircleAlert: "danger-circle", CircleCheck: "check-circle",
  CircleDashed: "record-minimalistic", CircleDot: "record-circle", CircleHelp: "question-circle",
  CircleMinus: "minus-circle", CircleX: "close-circle", Clock3: "clock-circle", Code: "code",
  Columns3: "columns-3", Command: "command", Copy: "copy", CornerDownRight: "arrow-to-down-right",
  CornerUpLeft: "arrow-to-top-left", Download: "download-minimalistic", Ellipsis: "more-horizontal",
  Eraser: "eraser", ExternalLink: "square-arrow-right-up", Eye: "eye", EyeOff: "eye-closed",
  File: "file", FileArchive: "file-zip", FileAudio: "file-audio", FileCode2: "file-code", FileCog: "file-cog",
  FileDiff: "git-diff", FileImage: "file-image", FileJson: "file-braces", FileLock: "file-lock",
  FilePenLine: "file-pen", FilePlay: "file-play", FilePlus: "file-add", FileSpreadsheet: "file-spreadsheet",
  FileTerminal: "file-terminal", FileText: "file-text", FileVideo: "file-video-camera", Files: "documents",
  FlaskConical: "test-tube", FoldVertical: "fold-vertical", Folder: "folder", FolderBookmark: "folder-favorite-bookmark",
  FolderCheck: "folder-check", FolderCode: "folder-code", FolderCog: "folder-cog", FolderGit2: "folder-git",
  FolderOpen: "folder-open", FolderOutput: "folder-output", FolderPlus: "add-folder", FolderRoot: "folder-2",
  FolderSearch: "folder-search", GitBranch: "git-branch", GitBranchPlus: "git-branch",
  GitCommitHorizontal: "git-commit", GitCompareArrows: "git-diff", GitFork: "git-fork",
  GitMerge: "branching-paths-up", GitPullRequest: "pull-request", GitPullRequestClosed: "pull-request",
  GitPullRequestDraft: "pull-request-draft", Globe: "globe", Hammer: "sledgehammer", Hand: "hand-shake",
  Hash: "hashtag", Heading1: "text-field", Heading2: "text-field", Heading3: "text-field",
  ImagePlus: "gallery-add", Info: "info-circle", Italic: "text-italic", Keyboard: "keyboard", Laptop: "laptop",
  Server: "server-square", WifiOff: "wifi-off", Lightbulb: "lightbulb", Link: "link", Link2: "link-minimalistic",
  List: "list", ListFilter: "filter", ListOrdered: "list-ordered", ListPlus: "list-plus", LoaderCircle: "loader",
  Lock: "lock", LogIn: "login-2", LogOut: "logout-2", Maximize2: "maximize", MessageCircle: "chat-round-line",
  MessageSquare: "chat-square", MessageSquarePlus: "chat-square-add", MessagesSquare: "chat-square-2",
  MessagesCircle: "chat-round-dots", Gauge: "speedometer-middle", ChartBar: "chart-2", Rows: "rows-3",
  Mic: "microphone", Minimize2: "minimize", Minus: "minus", Monitor: "monitor", Moon: "moon",
  MoreHorizontal: "more-horizontal", MousePointer2: "cursor", MousePointerClick: "cursor-square",
  NotebookText: "notebook", OctagonX: "forbidden-circle", Package: "box-minimalistic", PanelLeft: "panel-left",
  PanelRight: "panel-right", PanelRightClose: "panel-right-close", PanelRightOpen: "panel-right-open",
  Paperclip: "paperclip", Pause: "pause", Pencil: "pen", Pilcrow: "paragraph-spacing", WrapText: "wrap-text",
  Pin: "pin", PinOff: "pin", Pipette: "pipette", Play: "play", Plus: "plus", QrCode: "qr-code", Plug: "plug-circle",
  Puzzle: "widget-add", Quote: "quote", Redo2: "undo-right", RefreshCw: "refresh", RotateCcw: "undo-left-round",
  RotateCw: "restart", Save: "floppy-disk", Search: "magnifer", Settings: "settings", Settings2: "tuning",
  Share2: "share", Shield: "shield", ShieldAlert: "shield-warning", ShieldCheck: "shield-check",
  SlidersHorizontal: "slider-horizontal", SmilePlus: "smile-circle", Sparkles: "magic-stick-3", Square: "stop",
  SquareArrowOutUpRight: "square-arrow-right-up", SquareCode: "code-square", SquareDashedMousePointer: "square-dashed",
  SquarePen: "pen-new-square", SquareTerminal: "terminal", Star: "star", Strikethrough: "text-cross", Sun: "sun",
  SunMoon: "sun-2", Target: "target", Telescope: "telescope", Signpost: "signpost", Terminal: "terminal",
  TerminalSquare: "terminal", TextSearch: "file-search", Trash2: "trash-bin-minimalistic",
  TriangleAlert: "danger-triangle", Undo2: "undo-left", UserRound: "user-rounded", Users: "users-group-rounded",
  Wrench: "settings-minimalistic", X: "close", XCircle: "close-circle", Zap: "bolt", ClipboardList: "clipboard-list",
  Bookmark: "bookmark", GripVertical: "drag-handle", Smartphone: "smartphone", DeviceRotate: "smartphone-rotate-angle",
  WorkflowIcon: "structure", MoreVertical: "menu-dots-vertical", Cookie: "database", ZoomIn: "magnifier-zoom-in",
  ZoomOut: "magnifier-zoom-out", PictureInPicture: "pip", RecordDot: "record-circle", PowerIcon: "power",
  Unlink: "unlink", CameraShot: "camera", HomeButton: "home", House: "home", Palette: "palette",
  CloudOff: "cloud-cross", CloudArrowDown: "cloud-download", Planet: "planet", RotateView: "smartphone-rotate-angle",
  ScreenDashed: "scanner",
};

function inner(svg, file) {
  const m = svg.match(/<svg([^>]*)>([\s\S]*)<\/svg>/);
  if (!m) throw new Error(`${file}: not an svg`);
  const is16 = /viewBox="0 0 16 16"/.test(m[1]); // Zeron's own 16 px marks (check, close, terminal): scaled to 24
  if (!is16 && !/viewBox="0 0 24 24"/.test(m[1])) return null; // other sizes: use Solar instead
  const rootAttrs = [...m[1].matchAll(/\s([a-z-]+)="([^"]*)"/g)]
    .filter(([, k]) => !["xmlns", "width", "height", "viewBox", "class"].includes(k))
    .map(([, k, v]) => `${k}="${v}"`);
  const body = rootAttrs.length ? `<g ${rootAttrs.join(" ")}>${m[2].trim()}</g>` : m[2].trim();
  // A 16 px drawing scaled by 1.5 needs a stroke of 1.7 / 1.5 so it renders at 1.7.
  return is16 ? `<g transform="scale(1.5)">${normalize(body, +STROKE / 1.5)}</g>` : normalize(body);
}
/** Sets every stroke width and trims coordinates to 2 decimals (0.01 px of a 24 px drawing is invisible). */
function normalize(body, width = STROKE) {
  return body
    .replace(/stroke-width="[^"]*"/g, `stroke-width="${width}"`)
    .replace(/(fill|stroke)="(black|#000|#000000)"/g, '$1="currentColor"')
    .replace(/(?<!stroke-width="[\d.]*)\d+\.\d{3,}/g, (n) => String(Number(Number(n).toFixed(2))));
}

const used = [...new Set(Object.values(ICON_MAP))].sort();
const icons = {};
const sources = { zeron: [], solar: [] };
const missing = [];
for (const name of used) {
  const zeronFile = join(zeronDir, `${name}.svg`);
  let linear;
  const fromZeron = existsSync(zeronFile) ? inner(readFileSync(zeronFile, "utf8"), zeronFile) : null;
  if (fromZeron) {
    linear = fromZeron;
    sources.zeron.push(name);
  } else if (solar[`${name}-linear`]) {
    linear = normalize(solar[`${name}-linear`].body);
    sources.solar.push(name);
  } else {
    missing.push(name);
    continue;
  }
  const bold = solar[`${name}-bold`]?.body;
  icons[name] = bold ? [linear, normalize(bold)] : [linear];
}
if (missing.length) {
  console.error(`No Solar icon for: ${missing.join(", ")}`);
  process.exit(1);
}

const lines = [
  "// Generated by scripts/build-solar-icons.mjs. Do not edit by hand.",
  "// Solar Icon Set by 480 Design (CC BY 4.0) and Zeron's adjusted copies (MIT); see THIRD-PARTY-NOTICES.md.",
  "// Each entry is [linear body, bold body?], 24x24, strokes normalized to 1.7.",
  "",
  "export const SOLAR_ICONS: Record<string, readonly [string, string?]> = {",
  ...used.map((n) => `  ${JSON.stringify(n)}: ${JSON.stringify(icons[n])},`),
  "};",
  "",
  "/** Exported icon name -> Solar icon name (reviewed in scripts/build-solar-icons.mjs). */",
  "export const SOLAR_ICON_NAMES = {",
  ...Object.entries(ICON_MAP).map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`),
  "} as const;",
  "",
];
writeFileSync(join(root, "src/components/icons/solar-data.ts"), lines.join("\n"));
console.log(`${used.length} icons (${sources.zeron.length} from Zeron, ${sources.solar.length} from @iconify-json/solar), ${Object.keys(ICON_MAP).length} names`);
console.log(`Zeron: ${sources.zeron.join(" ")}`);
