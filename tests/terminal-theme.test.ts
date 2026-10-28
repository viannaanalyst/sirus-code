import assert from "node:assert/strict";
import { test } from "node:test";
import { ghosttyCursorStyle, ghosttyTheme, parseHexColor, terminalFontFamily, terminalOwnsKey } from "../src/lib/terminal-theme.ts";
import { mergeSettings } from "../src/lib/settings.ts";
import { MONO_FONTS } from "../src/lib/fonts.ts";
import { terminalAppearance } from "../src/lib/appearance.ts";

const supported = { translucency: true, dockIcon: true };

test("hex colors parse to opaque RGB and reject anything else", () => {
  assert.deepEqual(parseHexColor("#0c0c0c"), { r: 12, g: 12, b: 12 });
  assert.deepEqual(parseHexColor("#f4f4f500"), { r: 244, g: 244, b: 245 }, "the alpha byte is dropped");
  assert.deepEqual(parseHexColor("#fa0"), { r: 255, g: 170, b: 0 });
  for (const bad of ["", "red", "rgb(1,2,3)", "#12", "#12345", "#gggggg"]) assert.equal(parseHexColor(bad), null);
});

test("the Sirus ANSI palette maps to Ghostty's 16 slots in order", () => {
  const settings = mergeSettings({ theme: "dark" });
  const appearance = terminalAppearance(settings, supported);
  const theme = ghosttyTheme(appearance);
  assert.equal(theme.palette?.length, 16);
  assert.deepEqual(theme.palette?.[1], parseHexColor(appearance.red));
  assert.deepEqual(theme.palette?.[4], parseHexColor(appearance.blue));
  assert.deepEqual(theme.palette?.[8], parseHexColor(appearance.brightBlack));
  assert.deepEqual(theme.palette?.[15], parseHexColor(appearance.brightWhite));
  assert.deepEqual(theme.foreground, parseHexColor(appearance.foreground));
  assert.deepEqual(theme.cursor, parseHexColor(appearance.cursor));
  assert.equal(theme.selectionBackground, appearance.selectionBackground);
  assert.equal(theme.transparentBackground, false);
});

test("light and dark themes differ", () => {
  const dark = ghosttyTheme(terminalAppearance(mergeSettings({ theme: "dark" }), supported));
  const light = ghosttyTheme(terminalAppearance(mergeSettings({ theme: "light" }), supported));
  assert.notDeepEqual(dark.background, light.background);
  assert.notDeepEqual(dark.foreground, light.foreground);
});

test("window glass leaves the background unpainted while keeping the opaque theme color for reverse video (ADR-102)", () => {
  for (const palette of ["dark", "light"] as const) {
    const glass = ghosttyTheme(terminalAppearance(mergeSettings({ theme: palette, darkWindowTranslucent: true, lightWindowTranslucent: true }), supported));
    const opaque = ghosttyTheme(terminalAppearance(mergeSettings({ theme: palette, darkWindowTranslucent: false, lightWindowTranslucent: false }), supported));
    assert.equal(glass.transparentBackground, true);
    assert.equal(opaque.transparentBackground, false);
    assert.deepEqual(glass.background, opaque.background, "the colour behind reverse video is the theme colour, never black");
    assert.notDeepEqual(glass.background, { r: 0, g: 0, b: 0 });
  }
});

test("the dock surface decides transparency and tint when it is known", () => {
  const appearance = terminalAppearance(mergeSettings({ theme: "dark" }), supported);
  const tinted = ghosttyTheme(appearance, { background: "#202428" + "00", transparent: true });
  assert.deepEqual(tinted.background, { r: 0x20, g: 0x24, b: 0x28 });
  assert.equal(tinted.transparentBackground, true);
  const solid = ghosttyTheme(appearance, { background: "#202428", transparent: false });
  assert.equal(solid.transparentBackground, false);
});

test("cursor shapes map to Ghostty's style codes, defaulting to block", () => {
  assert.equal(ghosttyCursorStyle("bar"), 0);
  assert.equal(ghosttyCursorStyle("block"), 1);
  assert.equal(ghosttyCursorStyle("underline"), 2);
  assert.equal(ghosttyCursorStyle("anything else"), 1);
});

test("the terminal font resolves to a canvas-safe family for every choice", () => {
  assert.equal(terminalFontFamily("sfMono"), '"SF Mono"');
  assert.equal(terminalFontFamily("menlo"), "Menlo");
  for (const font of MONO_FONTS) {
    const family = terminalFontFamily(font.id);
    assert.equal(family, font.family);
    assert.doesNotMatch(family, /ui-monospace/, "canvas font strings reject the ui-monospace keyword");
  }
  assert.equal(terminalFontFamily("unknown" as never), MONO_FONTS[0].family, "unknown ids use the first font");
});

test("command-key chords stay with the app except copy, paste and select all", () => {
  assert.equal(terminalOwnsKey({ metaKey: false, key: "s" }), true);
  assert.equal(terminalOwnsKey({ metaKey: true, key: "s" }), false);
  for (const key of ["c", "C", "v", "a"]) assert.equal(terminalOwnsKey({ metaKey: true, key }), true);
});
