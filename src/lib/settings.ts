import { monoFontFamily, uiFontFamily, UI_FONTS, MONO_FONTS } from "./fonts";
import { resolveAppearanceMaterial } from "./appearance";
import { sanitizeShortcuts } from "./keybindings";
import { defaultNotifications, normalizeNotifications } from "./notifications";
import type { AgentProviderId, AppSettings, ProjectFolder } from "@/client/types";
import { AGENT_PROVIDER_IDS } from "@/client/types";
import { SIDEBAR_USAGE_LIMIT, USAGE_PROVIDER_IDS } from "./provider-usage";
import { RAIL_ITEMS } from "./rail";

export const defaultSettings: AppSettings = {
  notifications: defaultNotifications,
  usageProviders: ["codex"],
  sidebarUsageProviders: [],
  steerWhileRunning: false,
  ciAutoFix: false,
  prWatch: true,
  dictationEnterSends: false,
  foldFinishedTurns: true,
  showWorkingPanel: true,
  composerAutocorrect: true,
  showAstroMenuBar: true,
  githubLinksInApp: true,
  diffWordWrap: false,
  confirmArchive: false,
  confirmTerminalClose: true,
  windowSnapEnabled: false,
  windowSnapShortcut: "controlOptionCommandS",
  githubPins: [],
  railItemOrder: [],
  hiddenRailItems: [],
  railProjectShortcuts: [],
  defaultAgent: "codex",
  openLastProject: true,
  projectAutoIcons: false,
  chatBackground: null,
  chatBackgroundEffect: "none",
  chatBackgroundShowOn: "all",
  chatBackgroundEmptyVisibility: 24,
  chatBackgroundSessionVisibility: 24,
  worktreeBasePath: null,
  releaseWorktreeOnArchive: false,
  defaultSessionWorkspace: "ask",
  confirmCloseRunning: true,
  restorePreviousSessions: true,
  checkForUpdates: false,
  disabledProviders: [],
  providerPaths: {},
  theme: "dark",
  darkWindowTranslucent: false,
  lightWindowTranslucent: false,
  darkWindowOpacity: 85,
  lightWindowOpacity: 85,
  darkSidebarTranslucent: false,
  lightSidebarTranslucent: false,
  darkSidebarOpacity: 72,
  lightSidebarOpacity: 38,
  translucentOpacity: 85,
  systemUiFont: true,
  uiFont: "inter",
  codeFont: "plexMono",
  codeFontSize: 13,
  terminalFont: "plexMono",
  fontSmoothing: true,
  dockIcon: "default",
  density: "default",
  animations: true,
  composerLineSpeed: "slow",
  glass: false,
  pointerGlow: true,
  reduceMotion: false,
  uiFontSize: 13,
  gitAutoFetch: false,
  gitShowUntracked: true,
  gitConfirmDestructive: true,
  worktreeLocation: "automatic",
  worktreeBranchPattern: "sirus/{session-name}",
  terminalUseSystemShell: true,
  terminalFontSize: 13,
  terminalCursorStyle: "block",
  terminalScrollback: 2000,
  developerLogs: false,
  computerUseEnabled: false,
  agentsManageSessions: false,
  experimental: false,
  disabledModels: [],
  disabledSkills: [],
  favoriteModels: [],
  defaultModel: null,
  modelExecution: {},
  sidebarCollapsed: false,
  sidebarProjectOrder: [],
  sidebarProjectSortOrder: "manual",
  sidebarThreadSortOrder: "created_at",
  pinnedProjectIds: [],
  projectFolders: [],
  pinnedSessionIds: [],
  archivedSessionIds: [],
  environmentPanelDefaultOpen: false,
  showEnvironmentUsage: true,
  showEnvironmentRepository: true,
  showEnvironmentEditor: true,
  showEnvironmentPullRequest: true,
  showEnvironmentPinned: true,
  showEnvironmentNotepad: true,
  showEnvironmentInstructions: true,
  enableProviderUpdateChecks: true,
  locale: "pt-BR",
  customShortcuts: {},
};

export function mergeSettings(value: Partial<AppSettings> | null | undefined): AppSettings {
  return {
    ...defaultSettings,
    ...value,
    notifications: normalizeNotifications(value?.notifications),
    usageProviders: [...new Set((value?.usageProviders ?? defaultSettings.usageProviders).filter((id) => AGENT_PROVIDER_IDS.includes(id)))].slice(0, AGENT_PROVIDER_IDS.length),
    sidebarUsageProviders: [...new Set((value?.sidebarUsageProviders ?? []).filter((id) => USAGE_PROVIDER_IDS.includes(id)))].slice(0, SIDEBAR_USAGE_LIMIT),
    steerWhileRunning: value?.steerWhileRunning === true,
    ciAutoFix: value?.ciAutoFix === true,
    prWatch: value?.prWatch !== false,
    dictationEnterSends: value?.dictationEnterSends === true,
    foldFinishedTurns: value?.foldFinishedTurns !== false,
    showWorkingPanel: value?.showWorkingPanel !== false,
    composerAutocorrect: value?.composerAutocorrect !== false,
    showAstroMenuBar: value?.showAstroMenuBar !== false,
    githubLinksInApp: value?.githubLinksInApp !== false,
    diffWordWrap: value?.diffWordWrap === true,
    confirmArchive: value?.confirmArchive === true,
    releaseWorktreeOnArchive: value?.releaseWorktreeOnArchive === true,
    confirmTerminalClose: value?.confirmTerminalClose !== false,
    windowSnapEnabled: value?.windowSnapEnabled === true,
    windowSnapShortcut: (["controlOptionCommandS", "optionShiftS", "controlShiftS"] as const).find((id) => id === value?.windowSnapShortcut) ?? "controlOptionCommandS",
    railItemOrder: [...new Set((value?.railItemOrder ?? []).filter((id) => (RAIL_ITEMS as readonly string[]).includes(id)))],
    hiddenRailItems: [...new Set((value?.hiddenRailItems ?? []).filter((id) => id !== "home" && (RAIL_ITEMS as readonly string[]).includes(id)))],
    railProjectShortcuts: [...new Set((value?.railProjectShortcuts ?? []).filter((id) => typeof id === "string" && id.length > 0 && id.length <= 128))].slice(0, 12),
    githubPins: [...new Set((value?.githubPins ?? []).filter((pin) => typeof pin === "string" && /^[A-Za-z0-9-]{1,100}\/[A-Za-z0-9._-]{1,100}#[1-9]\d{0,7}$/.test(pin)))].slice(0, 200),
    disabledProviders: value?.disabledProviders ?? [],
    providerPaths: value?.providerPaths ?? {},
    modelExecution: value?.modelExecution ?? {},
    disabledModels: value?.disabledModels ?? [],
    computerUseEnabled: value?.computerUseEnabled === true,
    agentsManageSessions: value?.agentsManageSessions === true,
    chatBackground: typeof value?.chatBackground === "string" && /^chat-[0-9a-f-]{36}\.jpg$/.test(value.chatBackground) ? value.chatBackground : null,
    chatBackgroundEffect: (["none", "dither", "ascii", "halftone", "scanlines", "haze"] as const).find((effect) => effect === value?.chatBackgroundEffect) ?? "none",
    chatBackgroundShowOn: value?.chatBackgroundShowOn === "empty" ? "empty" : "all",
    chatBackgroundEmptyVisibility: boundedInteger(value?.chatBackgroundEmptyVisibility, 0, 100, 24),
    chatBackgroundSessionVisibility: boundedInteger(value?.chatBackgroundSessionVisibility, 0, 100, 24),
    disabledSkills: [...new Set((value?.disabledSkills ?? []).filter(name => typeof name === "string" && /^[a-z0-9][a-z0-9_.:-]{0,127}$/.test(name)))].slice(0, 512),
    favoriteModels: value?.favoriteModels ?? [],
    sidebarProjectOrder: sidebarIds(value?.sidebarProjectOrder),
    sidebarProjectSortOrder: value?.sidebarProjectSortOrder === "created_at" ? "created_at" : "manual",
    sidebarThreadSortOrder: value?.sidebarThreadSortOrder === "updated_at" ? "updated_at" : "created_at",
    showEnvironmentUsage: typeof value?.showEnvironmentUsage === "boolean" ? value.showEnvironmentUsage : true,
    showEnvironmentRepository: typeof value?.showEnvironmentRepository === "boolean" ? value.showEnvironmentRepository : true,
    showEnvironmentEditor: typeof value?.showEnvironmentEditor === "boolean" ? value.showEnvironmentEditor : true,
    showEnvironmentPullRequest: typeof value?.showEnvironmentPullRequest === "boolean" ? value.showEnvironmentPullRequest : true,
    showEnvironmentPinned: typeof value?.showEnvironmentPinned === "boolean" ? value.showEnvironmentPinned : true,
    showEnvironmentNotepad: typeof value?.showEnvironmentNotepad === "boolean" ? value.showEnvironmentNotepad : true,
    showEnvironmentInstructions: typeof value?.showEnvironmentInstructions === "boolean" ? value.showEnvironmentInstructions : true,
    pinnedProjectIds: sidebarIds(value?.pinnedProjectIds),
    projectFolders: projectFolders(value?.projectFolders),
    pinnedSessionIds: sidebarIds(value?.pinnedSessionIds),
    archivedSessionIds: sidebarIds(value?.archivedSessionIds),
    gitConfirmDestructive: true,
    composerLineSpeed: value?.composerLineSpeed === "smooth" || value?.composerLineSpeed === "fast" ? value.composerLineSpeed : "slow",
    theme: value?.theme === "light" || value?.theme === "system" ? value.theme : "dark",
    darkWindowTranslucent: (value?.theme as string) === "translucent" || booleanPreference(value?.darkWindowTranslucent, false),
    lightWindowTranslucent: booleanPreference(value?.lightWindowTranslucent, false),
    darkWindowOpacity: boundedInteger((value?.theme as string) === "translucent" ? value?.translucentOpacity : value?.darkWindowOpacity, 25, 100, 85),
    lightWindowOpacity: boundedInteger(value?.lightWindowOpacity, 25, 100, 85),
    density: value?.density === "compact" || value?.density === "comfortable" ? value.density : "default",
    darkSidebarTranslucent: booleanPreference(value?.darkSidebarTranslucent, false),
    lightSidebarTranslucent: booleanPreference(value?.lightSidebarTranslucent, false),
    darkSidebarOpacity: boundedInteger(value?.darkSidebarOpacity, 25, 100, 72),
    lightSidebarOpacity: boundedInteger(value?.lightSidebarOpacity, 25, 100, 38),
    translucentOpacity: boundedInteger(value?.translucentOpacity, 25, 100, 85),
    systemUiFont: booleanPreference(value?.systemUiFont, true),
    uiFont: UI_FONTS.some(font => font.id === value?.uiFont) ? value!.uiFont! : "inter",
    codeFont: MONO_FONTS.some(font => font.id === value?.codeFont) ? value!.codeFont! : "plexMono",
    terminalFont: MONO_FONTS.some(font => font.id === value?.terminalFont) ? value!.terminalFont! : "plexMono",
    uiFontSize: boundedInteger(value?.uiFontSize, 11, 18, 13),
    codeFontSize: boundedInteger(value?.codeFontSize, 10, 22, 13),
    terminalFontSize: boundedInteger(value?.terminalFontSize, 10, 22, 13),
    // Each terminal keeps its scrollback lines in memory; the native side applies the same bounds.
    terminalScrollback: boundedInteger(value?.terminalScrollback, 1000, 10_000, 2000),
    fontSmoothing: booleanPreference(value?.fontSmoothing, true),
    dockIcon: value?.dockIcon === "smokedGlass" || value?.dockIcon === "white" ? value.dockIcon : "default",
    locale: value?.locale === "en" ? "en" : "pt-BR",
    customShortcuts: sanitizeShortcuts(value?.customShortcuts),
  };
}

function projectFolders(folders: ProjectFolder[] | undefined): ProjectFolder[] {
  if (!Array.isArray(folders)) return [];
  return folders.filter((folder) => folder && typeof folder.id === "string" && folder.id && typeof folder.name === "string" && folder.name.trim())
    .slice(0, 64)
    .map((folder) => ({ id: folder.id, name: folder.name, look: folder.look ?? {}, projectIds: sidebarIds(folder.projectIds), collapsed: folder.collapsed === true }));
}

function sidebarIds(ids: string[] | undefined): string[] {
  return [...new Set((ids ?? []).filter((id) => typeof id === "string" && id.length > 0 && id.length <= 64))].slice(0, 4096);
}

export const GENERAL_SETTING_KEYS = ["defaultAgent", "locale", "defaultSessionWorkspace", "openLastProject", "projectAutoIcons",
  "confirmCloseRunning", "showAstroMenuBar", "restorePreviousSessions", "sidebarProjectSortOrder", "sidebarThreadSortOrder",
  "environmentPanelDefaultOpen", "showEnvironmentUsage", "showEnvironmentRepository", "showEnvironmentEditor", "showEnvironmentPullRequest",
  "showEnvironmentPinned", "showEnvironmentNotepad", "showEnvironmentInstructions"] as const satisfies readonly (keyof AppSettings)[];

/** A future-session preference, not a change to the selected native Session. */
export function chooseDefaultProvider(settings: AppSettings, provider: AgentProviderId): AppSettings {
  const model = parseModelKey(settings.defaultModel);
  return { ...settings, defaultAgent: provider, defaultModel: model?.provider === provider ? settings.defaultModel : null };
}

/** Restore this page's preferences while preserving other pages and owned metadata. */
export function resetGeneralSettings(settings: AppSettings): AppSettings {
  const restored = chooseDefaultProvider(settings, defaultSettings.defaultAgent);
  for (const key of GENERAL_SETTING_KEYS) Object.assign(restored, { [key]: defaultSettings[key] });
  return restored;
}

export function isProviderEnabled(settings: AppSettings, id: AgentProviderId) {
  return !settings.disabledProviders.includes(id);
}

export function modelKey(provider: AgentProviderId, modelId: string) {
  return `${provider}::${modelId}`;
}

export function parseModelKey(key: string | null | undefined): { provider: AgentProviderId; id: string } | null {
  if (!key) return null;
  const index = key.indexOf("::");
  if (index <= 0) return null;
  const candidate = key.slice(0, index);
  if (!(AGENT_PROVIDER_IDS as readonly string[]).includes(candidate)) return null;
  const provider = candidate as AgentProviderId;
  const id = key.slice(index + 2);
  if (!id) return null;
  return { provider, id };
}

export function isModelFavorite(settings: AppSettings, provider: AgentProviderId, modelId: string) {
  return settings.favoriteModels.includes(modelKey(provider, modelId));
}

export function applyAppearance(settings: AppSettings, support?: import("@/client/types").AppearanceSupport, systemPalette: "dark" | "light" = "dark") {
  const normalized = mergeSettings(settings);
  const root = document.documentElement;
  const material = resolveAppearanceMaterial(normalized, support, systemPalette);
  root.dataset.theme = material.palette;
  root.dataset.appearance = normalized.theme;
  // The chat background's strength and placement (ADR-089); the image comes from useChatBackground.
  root.style.setProperty("--chat-background-empty-opacity", String(normalized.chatBackgroundEmptyVisibility / 100));
  root.style.setProperty("--chat-background-session-opacity", String(normalized.chatBackgroundSessionVisibility / 100));
  root.dataset.chatBackgroundShowOn = normalized.chatBackgroundShowOn;
  root.dataset.chatBackgroundEffect = normalized.chatBackgroundEffect;
  root.dataset.windowGlass = material.windowGlass ? "on" : "off";
  root.dataset.sidebarGlass = material.sidebarGlass ? "on" : "off";
  root.dataset.popupGlass = material.sidebarGlass ? "on" : "off";
  root.dataset.density = normalized.density;
  root.dataset.animations = normalized.animations ? "on" : "off";
  root.dataset.pointerGlow = normalized.pointerGlow ? "on" : "off";
  root.dataset.reduceMotion = normalized.reduceMotion ? "on" : "off";
  root.dataset.fontSmoothing = normalized.fontSmoothing ? "on" : "off";
  root.style.fontSize = "13px";
  root.style.setProperty("--ui-font-scale", String(normalized.uiFontSize / 13));
  for (const name of ["--font-sans", "--font-body", "--font-display"]) root.style.setProperty(name, uiFontFamily(normalized));
  root.style.setProperty("--code-font-family", monoFontFamily(normalized.codeFont));
  root.style.setProperty("--code-font-size", `${normalized.codeFontSize}px`);
  root.style.setProperty("--terminal-font-family", monoFontFamily(normalized.terminalFont));
  root.style.setProperty("--window-opacity", `${material.windowOpacity}%`);
  root.style.setProperty("--sidebar-opacity", `${material.sidebarOpacity}%`);
  // Glass popups sit over the window's own translucent coat, so they stay a light tint (MonoCode-like) or the
  // desktop behind the window would barely show; blur and saturation keep text legible.
  root.style.setProperty("--popup-opacity", `${Math.max(24, Math.min(80, Math.round((material.windowGlass ? material.windowOpacity : material.sidebarOpacity) * 0.4)))}%`);
  rememberAppearance(root);
}

/** Where the last applied look is kept, so the next launch paints it before settings arrive (index.html). */
export const APPEARANCE_SNAPSHOT_KEY = "sirus.appearance";
const SNAPSHOT_DATASET = ["theme", "appearance", "windowGlass", "sidebarGlass", "popupGlass", "density", "animations", "reduceMotion", "fontSmoothing"] as const;

/**
 * Keeps the applied look (theme, glass, opacities, fonts) in localStorage. At launch the
 * inline script in index.html restores it before the stylesheet paints, so a glass window
 * never shows the opaque theme background while settings load (as MonoCode does).
 */
export function rememberAppearance(root: HTMLElement, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage) {
  try {
    const dataset: Record<string, string> = {};
    for (const key of SNAPSHOT_DATASET) { const value = root.dataset[key]; if (value !== undefined) dataset[key] = value; }
    // The chat background is a blob URL that does not survive a restart.
    const style = (root.getAttribute("style") ?? "").split(";").filter((rule) => rule.trim() && !rule.includes("--chat-background:")).join(";");
    storage?.setItem(APPEARANCE_SNAPSHOT_KEY, JSON.stringify({ dataset, style, dark: root.classList.contains("dark") }));
  } catch { /* Storage can be unavailable or full; the launch then paints the default. */ }
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
function booleanPreference(value: unknown, fallback: boolean): boolean { return typeof value === "boolean" ? value : fallback; }

export const CHAT_SETTING_KEYS = ["steerWhileRunning", "dictationEnterSends", "foldFinishedTurns", "showWorkingPanel", "composerAutocorrect", "githubLinksInApp", "diffWordWrap", "confirmArchive", "confirmTerminalClose"] as const satisfies readonly (keyof AppSettings)[];

export const APPEARANCE_SETTING_KEYS = ["theme", "darkWindowTranslucent", "lightWindowTranslucent", "darkWindowOpacity", "lightWindowOpacity", "darkSidebarTranslucent", "lightSidebarTranslucent", "darkSidebarOpacity", "lightSidebarOpacity", "translucentOpacity", "systemUiFont", "uiFont", "uiFontSize", "codeFont", "codeFontSize", "terminalFont", "terminalFontSize", "fontSmoothing", "dockIcon", "density", "animations", "composerLineSpeed", "pointerGlow", "reduceMotion"] as const satisfies readonly (keyof AppSettings)[];
export function resetAppearanceSettings(settings: AppSettings): AppSettings {
  const restored = { ...settings };
  for (const key of APPEARANCE_SETTING_KEYS) Object.assign(restored, { [key]: defaultSettings[key] });
  return restored;
}

export type SettingsSectionId =
  | "notifications"
  | "chat"
  | "general"
  | "providers"
  | "skills"
  | "computer"
  | "connections"
  | "mcp"
  | "appearance"
  | "git"
  | "worktrees"
  | "terminal"
  | "keybindings"
  | "advanced";
