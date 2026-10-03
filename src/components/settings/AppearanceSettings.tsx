import { RotateCcw } from "lucide-react";
import { useState } from "react";
import type { AppSettings, HostInfo } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { UI_FONTS, MONO_FONTS } from "@/lib/fonts";
import { APPEARANCE_SETTING_KEYS, defaultSettings, resetAppearanceSettings } from "@/lib/settings";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { Select } from "@/primitives/Select";
import { Switch } from "@/primitives/Switch";
import { Slider } from "@/components/arc/slider/slider";
import { SettingsGroup, SettingsRow, SettingsSection } from "./SettingsSection";
import { ThemeModePicker } from "./ThemeModePicker";
import { resolveAppearanceMaterial } from "@/lib/appearance";
import { useSystemPalette } from "@/lib/use-system-palette";
import "@/styles/general-settings.css";

const DOCK_ICONS = [
  { value: "default", file: "default", label: "Default" },
  { value: "smokedGlass", file: "smoked-glass", label: "Smoked glass" },
  { value: "white", file: "white", label: "White" },
] as const satisfies readonly { value: AppSettings["dockIcon"]; file: string; label: string }[];

export function FontSizeControl({ label, value, min = 10, max = 22, onChange }: { label: string; value: number; min?: number; max?: number; onChange: (value: number) => void }) {
  return <Select className="general-settings-select" label={label} value={String(value)} onChange={next => onChange(Number(next))}
    options={Array.from({ length: max - min + 1 }, (_, index) => ({ value: String(min + index), label: `${min + index} px` }))} />;
}
export function MonoFontControl({ label, value, onChange }: { label: string; value: AppSettings["codeFont"]; onChange: (value: AppSettings["codeFont"]) => void }) {
  const t = useTranslation();
  return <Select className="general-settings-select" label={label} value={value} onChange={onChange} options={MONO_FONTS.map(font => ({ value: font.id, label: font.label, description: font.installedOnly ? t("Uses the installed font, with a system fallback.") : undefined }))} />;
}
function OpacityControl({ label, value, disabled, onCommit }: { label: string; value: number; disabled: boolean; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(value);
  if (saved !== value) { setSaved(value); setDraft(value); }
  return <Slider className="appearance-opacity" label={label} value={draft} min={25} max={100} step={1} format={next => `${next}%`} disabled={disabled} onValueChange={setDraft} onValueCommit={onCommit} />;
}
export function AppearanceSettings({ settings, host, onSave }: { settings: AppSettings; host: HostInfo | null; onSave: (settings: AppSettings) => void }) {
  const t = useTranslation();
  const systemPalette = useSystemPalette();
  const { palette } = resolveAppearanceMaterial(settings, host?.appearanceSupport, systemPalette);
  const supported = host?.appearanceSupport?.translucency === true;
  const nativeNote = supported ? "Choose the amount of smoked glass tint." : "Desktop glass is unavailable on this host. An opaque surface is used.";
  const boolRow = (key: "systemUiFont" | "fontSmoothing" | "animations" | "pointerGlow" | "reduceMotion", title: string, description?: string) => <SettingsRow title={t(title)} description={description ? t(description) : undefined}><Switch checked={settings[key]} label={t(title)} onChange={value => onSave({ ...settings, [key]: value })} /></SettingsRow>;
  const sidebarKey = palette === "light" ? "lightSidebarTranslucent" : "darkSidebarTranslucent";
  const windowKey = palette === "light" ? "lightWindowTranslucent" : "darkWindowTranslucent";
  const glass = settings[windowKey] || settings[sidebarKey];
  const opacityKey = settings[windowKey] ? palette === "light" ? "lightWindowOpacity" : "darkWindowOpacity" : palette === "light" ? "lightSidebarOpacity" : "darkSidebarOpacity";
  return <div className="general-settings appearance-settings"><SettingsSection title={t("Appearance")} description={t("Personalize materials, typography and motion.")}
    headerAction={<InteractiveButton variant="secondary" glow={false} disabled={!APPEARANCE_SETTING_KEYS.some(key => settings[key] !== defaultSettings[key])} onClick={() => onSave(resetAppearanceSettings(settings))}><RotateCcw size={14} aria-hidden="true" />{t("Restore defaults")}</InteractiveButton>}>
    <SettingsGroup title={t("Theme")}><ThemeModePicker value={settings.theme} onChange={theme => onSave({ ...settings, theme })} /></SettingsGroup>
    <SettingsGroup title={t("Materials")} card>
      <SettingsRow title={t("Translucency")} description={t(supported ? "Menus and popups follow the active theme and material." : nativeNote)}><Switch label={t("Translucency")} checked={glass} disabled={!supported} onChange={value => onSave({ ...settings, [windowKey]: value, [sidebarKey]: false })} /></SettingsRow>
      {glass && <SettingsRow title={t("Apply translucency to")}><Select className="general-settings-select" label={t("Apply translucency to")} disabled={!supported} value={settings[windowKey] ? "window" : "sidebar"} onChange={scope => onSave({ ...settings, [windowKey]: scope === "window", [sidebarKey]: scope === "sidebar" })} options={[{ value: "window", label: t("Whole window") }, { value: "sidebar", label: t("Sidebar only") }]} /></SettingsRow>}
      {glass && <SettingsRow title={t(settings[windowKey] ? "Window opacity" : "Sidebar opacity")} description={t(nativeNote)}><OpacityControl label={t(settings[windowKey] ? "Window opacity" : "Sidebar opacity")} value={settings[opacityKey]} disabled={!supported} onCommit={value => onSave({ ...settings, [opacityKey]: value })} /></SettingsRow>}
    </SettingsGroup>
    <SettingsGroup title={t("Interface typography")} card>
      {boolRow("systemUiFont", "Use system UI font", "Keeps your chosen font ready when the system override is off.")}
      <SettingsRow title={t("UI font")} description={settings.systemUiFont ? t("The system font is active; this choice is preserved for later.") : undefined}><Select className="general-settings-select" disabled={settings.systemUiFont} label={t("UI font")} value={settings.uiFont} onChange={uiFont => onSave({ ...settings, uiFont })} options={UI_FONTS.map(font => ({ value: font.id, label: font.label, description: font.installedOnly ? t("Uses the installed font, with a system fallback.") : undefined }))} /></SettingsRow>
      <SettingsRow title={t("UI font size")}><FontSizeControl label={t("UI font size")} value={settings.uiFontSize} min={11} max={18} onChange={uiFontSize => onSave({ ...settings, uiFontSize })} /></SettingsRow>
      {boolRow("fontSmoothing", "Font smoothing")}
      <SettingsRow title={t("UI density")} description={t("Adjusts spacing independently of text size.")}><Select className="general-settings-select" label={t("UI density")} value={settings.density} onChange={density => onSave({ ...settings, density })} options={[{ value: "compact", label: t("Compact") }, { value: "default", label: t("Comfortable") }, { value: "comfortable", label: t("Spacious") }]} /></SettingsRow>
    </SettingsGroup>
    <SettingsGroup title={t("Code typography")} card>
      <SettingsRow title={t("Code font")} description={t("Applies to transcript code, diffs and the editor.")}><MonoFontControl label={t("Code font")} value={settings.codeFont} onChange={codeFont => onSave({ ...settings, codeFont })} /></SettingsRow>
      <SettingsRow title={t("Code font size")}><FontSizeControl label={t("Code font size")} value={settings.codeFontSize} onChange={codeFontSize => onSave({ ...settings, codeFontSize })} /></SettingsRow>
    </SettingsGroup>
    <SettingsGroup title={t("Terminal typography")} card>
      <SettingsRow title={t("Terminal font")}><MonoFontControl label={t("Terminal font")} value={settings.terminalFont} onChange={terminalFont => onSave({ ...settings, terminalFont })} /></SettingsRow>
      <SettingsRow title={t("Terminal font size")}><FontSizeControl label={t("Terminal font size")} value={settings.terminalFontSize} onChange={terminalFontSize => onSave({ ...settings, terminalFontSize })} /></SettingsRow>
    </SettingsGroup>
    <SettingsGroup title={t("Effects and motion")} card>
      {boolRow("animations", "Interface animations")}
      {boolRow("pointerGlow", "Cursor-reactive button effects")}
      <SettingsRow title={t("Composer line speed")} description={t("The silver line pauses while the text field is focused.")}><Select className="general-settings-select" label={t("Composer line speed")} value={settings.composerLineSpeed} onChange={composerLineSpeed => onSave({ ...settings, composerLineSpeed })} options={[{ value: "slow", label: t("Slow") }, { value: "smooth", label: t("Smooth") }, { value: "fast", label: t("Fast") }]} /></SettingsRow>
      {boolRow("reduceMotion", "Reduce motion", "Also respects prefers-reduced-motion from the OS.")}
    </SettingsGroup>
    <SettingsGroup title={t("Application")} card><SettingsRow title={t("Dock icon")} description={t(!host?.appearanceSupport?.dockIcon ? "Dock customization is unavailable on this host." : "Choose the icon shown in the Dock.")}>
      <div className="appearance-dock-options" role="group" aria-label={t("Dock icon")}>{DOCK_ICONS.map(icon => <button key={icon.value} type="button" aria-label={t(icon.label)} disabled={!host?.appearanceSupport?.dockIcon} aria-pressed={settings.dockIcon === icon.value} onClick={() => onSave({ ...settings, dockIcon: icon.value })}><img src={`/dock-icons/${icon.file}.png`} alt="" /></button>)}</div>
    </SettingsRow></SettingsGroup>
  </SettingsSection></div>;
}
