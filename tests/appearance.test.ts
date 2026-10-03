import assert from "node:assert/strict";
import { test } from "node:test";
import { APPEARANCE_SETTING_KEYS, applyAppearance, defaultSettings, mergeSettings, resetAppearanceSettings } from "../src/lib/settings.ts";
import { resolveAppearanceMaterial, terminalAppearance } from "../src/lib/appearance.ts";
import { UI_FONTS, MONO_FONTS, SYSTEM_UI_FONT, uiFontFamily, monoFontFamily } from "../src/lib/fonts.ts";
import { readSystemPalette, subscribeSystemPalette } from "../src/lib/use-system-palette.ts";

test("System follows media changes and disposes its listener without polling", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  let dark = false;
  const listeners = new Set<() => void>();
  const media = { get matches() { return dark; }, addEventListener: (_: string, callback: () => void) => listeners.add(callback), removeEventListener: (_: string, callback: () => void) => listeners.delete(callback) };
  Object.defineProperty(globalThis, "window", { value: { matchMedia: () => media }, configurable: true });
  try {
    let changes = 0;
    const stop = subscribeSystemPalette(() => changes++);
    assert.equal(readSystemPalette(), "light");
    dark = true; listeners.forEach(listener => listener());
    assert.equal(changes, 1); assert.equal(readSystemPalette(), "dark");
    stop(); assert.equal(listeners.size, 0);
  } finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
});

test("partial/legacy Appearance uses closed modes and independent, bounded preferences", () => {
  const legacy = mergeSettings({ theme: "system", glass: true } as never);
  assert.equal(legacy.theme, "system");
  assert.equal(legacy.darkSidebarTranslucent, false);
  assert.equal(legacy.glass, true, "legacy compatibility does not enable native glass");
  for (const [key, min, max, fallback] of [["darkWindowOpacity", 25, 100, 85], ["lightWindowOpacity", 25, 100, 85], ["uiFontSize", 11, 18, 13], ["codeFontSize", 10, 22, 13], ["terminalFontSize", 10, 22, 13], ["darkSidebarOpacity", 25, 100, 72], ["lightSidebarOpacity", 25, 100, 38], ["translucentOpacity", 25, 100, 85]] as const) {
    for (const invalid of [min - 1, max + 1, min + .5, NaN, Infinity, "13", null]) assert.equal(mergeSettings({ [key]: invalid } as never)[key], fallback);
    for (const valid of [min, max]) assert.equal(mergeSettings({ [key]: valid })[key], valid);
  }
  const invalid = mergeSettings({ theme: "invalid", uiFont: "path", codeFont: "url", terminalFont: "css", dockIcon: "silver", systemUiFont: null, fontSmoothing: 1 } as never);
  assert.equal(invalid.theme, "dark"); assert.equal(invalid.uiFont, "inter"); assert.equal(invalid.codeFont, "plexMono"); assert.equal(invalid.terminalFont, "plexMono"); assert.equal(invalid.dockIcon, "default"); assert.ok(invalid.systemUiFont && invalid.fontSmoothing);
});

test("Appearance reset preserves execution, terminal behavior and owned metadata", () => {
  const settings = mergeSettings({ theme: "dark", darkWindowTranslucent: true, uiFont: "geist", codeFont: "fira", terminalFont: "menlo", terminalFontSize: 22, dockIcon: "smokedGlass", density: "compact", defaultAgent: "claude", terminalScrollback: 5000, locale: "en", pinnedSessionIds: ["s"], glass: true });
  const previous = structuredClone(settings);
  const reset = resetAppearanceSettings(settings);
  for (const key of APPEARANCE_SETTING_KEYS) assert.equal(reset[key], defaultSettings[key]);
  assert.equal(reset.defaultAgent, "claude"); assert.equal(reset.terminalScrollback, 5000); assert.equal(reset.locale, "en"); assert.equal(reset.glass, true); assert.deepEqual(reset.pinnedSessionIds, ["s"]); assert.deepEqual(settings, previous);
});

test("each Dock alternative survives persistence and Appearance reset restores the original", () => {
  for (const dockIcon of ["default", "smokedGlass", "white"] as const) {
    const saved = mergeSettings({ dockIcon, defaultAgent: "claude" });
    const restored = mergeSettings(JSON.parse(JSON.stringify(saved)));
    assert.equal(restored.dockIcon, dockIcon);
    const reset = resetAppearanceSettings(restored);
    assert.equal(reset.dockIcon, "default");
    assert.equal(reset.defaultAgent, "claude");
  }
});

test("palette and materials resolve independently, with native support required", () => {
  const supported = { translucency: true, dockIcon: true };
  for (const theme of ["dark", "light", "system"] as const) for (const systemPalette of ["dark", "light"] as const) {
    const palette = theme === "system" ? systemPalette : theme;
    const settings = mergeSettings({ theme, darkWindowTranslucent: true, lightWindowTranslucent: false, lightSidebarTranslucent: true, darkWindowOpacity: 73, lightWindowOpacity: 91 });
    assert.equal(resolveAppearanceMaterial(settings, undefined, systemPalette).windowGlass, false);
    assert.equal(resolveAppearanceMaterial(settings, { translucency: false, dockIcon: false }, systemPalette).sidebarGlass, false);
    const native = resolveAppearanceMaterial(settings, supported, systemPalette);
    assert.equal(native.palette, palette);
    assert.equal(native.windowGlass, palette === "dark"); assert.equal(native.sidebarGlass, true);
    assert.equal(native.windowOpacity, palette === "dark" ? 73 : 91);
    assert.equal(native.sidebarOpacity, palette === "dark" ? 72 : 38);
    assert.equal(terminalAppearance(settings, supported, systemPalette).background, palette === "dark" ? "#00000000" : "#f4f4f5");
    const opposite = { ...settings, darkWindowTranslucent: false, lightWindowTranslucent: true };
    assert.equal(resolveAppearanceMaterial(opposite, supported, systemPalette).windowGlass, palette === "light");
  }
});

test("retained neutral glass migrates to Dark window glass without dropping typography or Light preferences", () => {
  const migrated = mergeSettings({ theme: "translucent", translucentOpacity: 43, uiFont: "geist", lightSidebarTranslucent: true, lightWindowOpacity: 92 } as never);
  assert.equal(migrated.theme, "dark"); assert.equal(migrated.darkWindowTranslucent, true);
  assert.equal(migrated.darkWindowOpacity, 43); assert.equal(migrated.uiFont, "geist");
  assert.equal(migrated.lightSidebarTranslucent, true); assert.equal(migrated.lightWindowOpacity, 92);
  assert.deepEqual(mergeSettings(JSON.parse(JSON.stringify(migrated))), migrated);
});

test("system UI override retains custom font and code/terminal families and sizes remain independent", () => {
  for (const ui of UI_FONTS) {
    const settings = mergeSettings({ uiFont: ui.id, systemUiFont: true, codeFont: "jetbrains", codeFontSize: 10, terminalFont: "ubuntu", terminalFontSize: 22 });
    assert.equal(uiFontFamily(settings), SYSTEM_UI_FONT); assert.equal(settings.uiFont, ui.id);
    assert.ok(uiFontFamily({ ...settings, systemUiFont: false }).includes(SYSTEM_UI_FONT));
    assert.equal(settings.codeFontSize, 10); assert.equal(settings.terminalFontSize, 22);
    assert.notEqual(monoFontFamily(settings.codeFont), monoFontFamily(settings.terminalFont));
  }
  assert.equal(UI_FONTS.length, 6); assert.equal(MONO_FONTS.length, 12);
});


test("root application writes independent role fonts, density and real material flags", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const properties = new Map<string, string>();
  const root = { dataset: {} as Record<string, string>, style: { fontSize: "", setProperty: (key: string, value: string) => properties.set(key, value) } };
  Object.defineProperty(globalThis, "document", { value: { documentElement: root }, configurable: true });
  try {
    const settings = mergeSettings({ theme: "dark", darkWindowTranslucent: true, systemUiFont: false, uiFont: "geist", uiFontSize: 18, codeFont: "fira", codeFontSize: 10, terminalFont: "menlo", terminalFontSize: 22, density: "compact", fontSmoothing: false });
    applyAppearance(settings, { translucency: true, dockIcon: true });
    assert.equal(root.dataset.windowGlass, "on"); assert.equal(root.dataset.theme, "dark"); assert.equal(root.dataset.density, "compact"); assert.equal(root.dataset.fontSmoothing, "off");
    assert.equal(root.style.fontSize, "13px", "density never changes layout rem scale");
    assert.equal(properties.get("--ui-font-scale"), String(18 / 13));
    assert.equal(properties.get("--font-body"), properties.get("--font-sans")); assert.equal(properties.get("--font-display"), properties.get("--font-sans"));
    assert.equal(properties.get("--code-font-family"), monoFontFamily("fira")); assert.equal(properties.get("--code-font-size"), "10px"); assert.equal(properties.get("--terminal-font-family"), monoFontFamily("menlo"));
    applyAppearance({ ...settings, theme: "system" }, { translucency: true, dockIcon: true }, "light");
    assert.equal(root.dataset.theme, "light"); assert.equal(root.dataset.windowGlass, "off");
    applyAppearance(settings);
    assert.equal(root.dataset.windowGlass, "off"); assert.equal(root.dataset.sidebarGlass, "off");
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document");
  }
});
