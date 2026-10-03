import {
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileCog,
  FileImage,
  FileJson,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileVideo,
  FlaskConical,
  Folder,
  FolderBookmark,
  FolderCheck,
  FolderCode,
  FolderCog,
  FolderGit2,
  FolderOpen,
  FolderOutput,
  FolderRoot,
  FolderSearch,
  GitBranch,
  Package,
  type LucideIcon,
} from "lucide-react";

export interface FileIconSpec {
  Icon: LucideIcon;
  color: string;
}

const typescript: FileIconSpec = { Icon: FileCode2, color: "#3178c6" };
const react: FileIconSpec = { Icon: FileCode2, color: "#61dafb" };
const javascript: FileIconSpec = { Icon: FileCode2, color: "#f7df1e" };
const json: FileIconSpec = { Icon: FileJson, color: "#f5c542" };
const markdown: FileIconSpec = { Icon: FileText, color: "#6cb6ff" };
const python: FileIconSpec = { Icon: FileCode2, color: "#3776ab" };
const rust: FileIconSpec = { Icon: FileCode2, color: "#dea584" };
const php: FileIconSpec = { Icon: FileCode2, color: "#777bb4" };
const java: FileIconSpec = { Icon: FileCode2, color: "#f89820" };
const c: FileIconSpec = { Icon: FileCode2, color: "#659ad2" };
const vue: FileIconSpec = { Icon: FileCode2, color: "#42b883" };
const svelte: FileIconSpec = { Icon: FileCode2, color: "#ff3e00" };
const config: FileIconSpec = { Icon: FileCog, color: "#a78bfa" };
const text: FileIconSpec = { Icon: FileText, color: "#94a3b8" };
const sheet: FileIconSpec = { Icon: FileSpreadsheet, color: "#22c55e" };
const command: FileIconSpec = { Icon: FileTerminal, color: "#4ade80" };
const lock: FileIconSpec = { Icon: FileLock, color: "#f59e0b" };
const image: FileIconSpec = { Icon: FileImage, color: "#22c55e" };
const pdf: FileIconSpec = { Icon: FileText, color: "#ef4444" };
const zip: FileIconSpec = { Icon: FileArchive, color: "#f97316" };
const video: FileIconSpec = { Icon: FileVideo, color: "#c084fc" };
const audio: FileIconSpec = { Icon: FileAudio, color: "#38bdf8" };
const git: FileIconSpec = { Icon: GitBranch, color: "#f05032" };
const npm: FileIconSpec = { Icon: Package, color: "#cb3837" };
const fallback: FileIconSpec = { Icon: File, color: "#7d7d7d" };

const BY_EXTENSION: Record<string, FileIconSpec> = {
  ts: typescript, mts: typescript, cts: typescript,
  tsx: react, jsx: react,
  js: javascript, mjs: javascript, cjs: javascript,
  json: json, json5: json, jsonc: json,
  md: markdown, mdx: markdown, mdc: markdown, markdown: markdown,
  py: python, pyi: python, pyc: python, pyw: python,
  rs: rust,
  php: php, phtml: php,
  java: java,
  c: c, h: c, cpp: c, hpp: c, cc: c, cs: c,
  vue: vue,
  svelte: svelte,
  yml: config, yaml: config, toml: config, ini: config, conf: config, cfg: config, env: config,
  txt: text, log: text,
  csv: sheet, tsv: sheet, xls: sheet, xlsx: sheet, ods: sheet,
  rtf: text, doc: text, docx: text, odt: text, ppt: text, pptx: text, odp: text,
  sh: command, bash: command, zsh: command, fish: command, bat: command, ps1: command, psm1: command, psd1: command,
  lock: lock,
  png: image, jpg: image, jpeg: image, gif: image, webp: image, bmp: image, tiff: image, avif: image, ico: image, svg: image,
  pdf: pdf,
  zip: zip, tar: zip, gz: zip, tgz: zip, rar: zip, "7z": zip, bz2: zip, xz: zip,
  mp4: video, m4v: video, mov: video, webm: video, mkv: video, avi: video,
  mp3: audio, wav: audio, flac: audio, ogg: audio, m4a: audio, aac: audio,
};

const BY_FILENAME: Record<string, FileIconSpec> = {
  "package.json": npm,
  "package-lock.json": npm,
  "pnpm-lock.yaml": npm,
  "pnpm-workspace.yaml": npm,
  "yarn.lock": npm,
  "bun.lock": npm,
  "bun.lockb": npm,
  "cargo.toml": rust,
  "cargo.lock": rust,
  "rust-toolchain.toml": rust,
  "requirements.txt": python,
  "pipfile": python,
  "pyproject.toml": python,
  "setup.py": python,
  "setup.cfg": python,
  "tsconfig.json": typescript,
  "readme.md": markdown,
  "license": text,
  "license.md": text,
  "license.txt": text,
  ".gitignore": git,
  ".gitattributes": git,
  ".gitmodules": git,
  ".gitkeep": git,
  ".gitconfig": git,
  ".env": config,
  "dockerfile": config,
  "makefile": command,
};

export function fileIconFor(name: string): FileIconSpec {
  const lower = name.toLowerCase();
  const byName = BY_FILENAME[lower];
  if (byName) return byName;
  if (lower.startsWith("tsconfig.") || lower.endsWith(".tsbuildinfo")) return typescript;
  if (lower.startsWith(".env")) return config;
  if (lower.startsWith(".git")) return git;
  if (lower.endsWith(".d.ts")) return typescript;
  const extension = lower.includes(".") ? lower.split(".").pop() ?? "" : "";
  return BY_EXTENSION[extension] ?? fallback;
}

const FOLDER_DEFAULT: FileIconSpec = { Icon: Folder, color: "#8b95a7" };
const FOLDER_DEFAULT_OPEN: FileIconSpec = { Icon: FolderOpen, color: "#8b95a7" };
const FOLDER_BY_NAME: Record<string, FileIconSpec> = {
  ".vscode": { Icon: FolderCog, color: "#2196f3" },
  ".idea": { Icon: FolderCog, color: "#f59e0b" },
  ".git": { Icon: FolderGit2, color: "#f05032" },
  ".github": { Icon: FolderGit2, color: "#e6edf3" },
  ".config": { Icon: FolderCog, color: "#a78bfa" },
  config: { Icon: FolderCog, color: "#a78bfa" },
  docs: { Icon: FolderBookmark, color: "#4fc3f7" },
  doc: { Icon: FolderBookmark, color: "#4fc3f7" },
  documentation: { Icon: FolderBookmark, color: "#4fc3f7" },
  public: { Icon: FolderRoot, color: "#38bdf8" },
  static: { Icon: FolderRoot, color: "#38bdf8" },
  assets: { Icon: FolderRoot, color: "#c084fc" },
  src: { Icon: FolderCode, color: "#42a5f5" },
  app: { Icon: FolderCode, color: "#42a5f5" },
  lib: { Icon: FolderCode, color: "#42a5f5" },
  packages: { Icon: FolderCode, color: "#42a5f5" },
  components: { Icon: FolderCode, color: "#42a5f5" },
  scripts: { Icon: FolderCog, color: "#4ade80" },
  tests: { Icon: FlaskConical, color: "#22c55e" },
  test: { Icon: FlaskConical, color: "#22c55e" },
  spec: { Icon: FlaskConical, color: "#22c55e" },
  specs: { Icon: FlaskConical, color: "#22c55e" },
  __tests__: { Icon: FlaskConical, color: "#22c55e" },
  e2e: { Icon: FlaskConical, color: "#22c55e" },
  "src-tauri": { Icon: FolderCog, color: "#dea584" },
  previews: { Icon: FolderSearch, color: "#38bdf8" },
  build: { Icon: FolderOutput, color: "#f97316" },
  dist: { Icon: FolderOutput, color: "#f97316" },
  out: { Icon: FolderOutput, color: "#f97316" },
  target: { Icon: FolderOutput, color: "#f97316" },
  "graphify-out": { Icon: FolderOutput, color: "#94a3b8" },
  coverage: { Icon: FolderCheck, color: "#22c55e" },
  hooks: { Icon: FolderCog, color: "#a78bfa" },
};

export function folderIconFor(name: string, open: boolean): FileIconSpec {
  return FOLDER_BY_NAME[name.toLowerCase()] ?? (open ? FOLDER_DEFAULT_OPEN : FOLDER_DEFAULT);
}
