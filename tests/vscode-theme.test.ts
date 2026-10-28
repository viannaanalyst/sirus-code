import assert from "node:assert/strict";
import { test } from "node:test";
import type { VsCodeTheme } from "../src/client/types.ts";
import { contrast, ensureContrast, flatten, parseColor, type Rgba } from "../src/lib/color-math.ts";
import { terminalAppearance } from "../src/lib/appearance.ts";
import { importedSyntaxFor } from "../src/lib/code-theme-state.ts";
import { mergeSettings, resetAppearanceSettings } from "../src/lib/settings.ts";
import { CONTRAST, MAX_INSTALLED_THEMES, THEME_TOKEN_NAMES, activeVsCodeTheme, applyThemeTokens, guardAnsi, mapVsCodeTheme, normalizeActiveTheme, normalizeVsCodeThemes, resolveScope } from "../src/lib/vscode-theme.ts";

const rgb = (value: string): Rgba => parseColor(value)!;
let counter = 0;
const id = () => `vsc-${(counter++).toString(16).padStart(16, "0")}`;

function theme(overrides: Partial<VsCodeTheme> = {}): VsCodeTheme {
  return { id: id(), name: "Test", kind: "dark", source: "local:test.json", colors: {}, tokenColors: [], ...overrides };
}
/** A dark theme whose foreground, comments and accent are all too dim for the surfaces. */
function dimDark(): VsCodeTheme {
  return theme({
    colors: {
      "editor.background": "#1e1e1e", "sideBar.background": "#252526", foreground: "#4a4a4a", descriptionForeground: "#3a3a3a",
      "button.background": "#202040", "editorError.foreground": "#300000", "terminal.ansiBlue": "#000040", "terminal.ansiBlack": "#101010", "terminal.ansiRed": "#400000",
    },
    tokenColors: [
      { scope: [], foreground: "#555555" },
      { scope: ["comment"], foreground: "#2a2a2a", fontStyle: "italic" },
      { scope: ["keyword"], foreground: "#220044" },
      { scope: ["string"], foreground: "#ce9178" },
    ],
  });
}
function paleLight(): VsCodeTheme {
  return theme({
    kind: "light",
    colors: { "editor.background": "#fdf6e3", "sideBar.background": "#eee8d5", foreground: "#cccccc", "button.background": "#f0f0a0", "terminal.ansiWhite": "#fefefe", "terminal.ansiYellow": "#f5f5a0" },
    tokenColors: [{ scope: ["comment"], foreground: "#eeeeee" }, { scope: ["keyword"], foreground: "#ffff99" }],
  });
}

const surfaces = (mapped: ReturnType<typeof mapVsCodeTheme>) => ["--background-0", "--background-1", "--background-2", "--background-3"].map((name) => rgb(mapped.css[name]));

test("text tokens are lifted to their contrast floors on every surface", () => {
  for (const source of [dimDark(), paleLight()]) {
    const mapped = mapVsCodeTheme(source);
    const backdrops = surfaces(mapped);
    const check = (token: string, minimum: number, on = backdrops) => {
      const color = flatten(rgb(mapped.css[token]), backdrops[0]);
      for (const backdrop of on) assert.ok(contrast(color, backdrop) >= minimum - 0.05, `${source.kind} ${token} ${mapped.css[token]} on ${backdrop.r},${backdrop.g},${backdrop.b}`);
    };
    check("--text-primary", CONTRAST.primary);
    check("--text-secondary", CONTRAST.secondary);
    check("--text-muted", CONTRAST.muted);
    for (const token of ["--accent", "--danger", "--success", "--warning", "--info", "--merged"]) check(token, CONTRAST.accent, backdrops.slice(0, 3));
  }
});

test("a readable theme keeps its own colours", () => {
  const source = theme({ colors: { "editor.background": "#282a36", foreground: "#f8f8f2", "button.background": "#bd93f9" } });
  const mapped = mapVsCodeTheme(source);
  assert.equal(mapped.css["--background-0"], "#282a36");
  assert.equal(mapped.css["--text-primary"], "#f8f8f2");
  assert.equal(mapped.css["--accent"], "#bd93f9");
});

test("missing colours fall back to Sirus values instead of leaving gaps", () => {
  const mapped = mapVsCodeTheme(theme({ colors: { "editor.background": "#101018" } }));
  for (const name of THEME_TOKEN_NAMES) if (name !== "--switch-track-on") assert.ok(mapped.css[name], `${name} is set`);
  assert.ok(contrast(rgb(mapped.css["--text-primary"]), rgb(mapped.css["--background-0"])) >= CONTRAST.primary);
  const light = mapVsCodeTheme(theme({ kind: "light", colors: {} }));
  assert.equal(light.css["--background-0"], "#ffffff");
  assert.ok(light.css["--switch-track-on"], "the light palette derives its switch track");
});

test("surface tints stay translucent-friendly: hairlines are alpha ink and glass tokens exist", () => {
  const mapped = mapVsCodeTheme(theme({ colors: { "editor.background": "#101010", foreground: "#eeeeee" } }));
  assert.match(mapped.css["--border-subtle"], /^#[0-9a-f]{8}$/);
  assert.match(mapped.css["--accent-muted"], /^#[0-9a-f]{8}$/);
  assert.equal(mapped.css["--glass"], mapped.css["--background-1"]);
  assert.equal(mapped.css["--sidebar-base"], mapped.css["--background-1"]);
});

test("a theme border is used only when it shows against the editor", () => {
  const visible = mapVsCodeTheme(theme({ colors: { "editor.background": "#101010", "sideBar.border": "#555555" } }));
  assert.equal(visible.css["--border-default"], "#555555");
  const hidden = mapVsCodeTheme(theme({ colors: { "editor.background": "#101010", "sideBar.border": "#111111" } }));
  assert.match(hidden.css["--border-default"], /^#[0-9a-f]{8}$/);
});

test("syntax colours follow the theme's token rules and are guarded for contrast", () => {
  const mapped = mapVsCodeTheme(dimDark());
  const surface = rgb(mapped.syntax.background);
  const { syntax } = mapped.syntax;
  for (const [key, style] of Object.entries(syntax)) {
    const minimum = ["comment", "comment.doc", "markup.quote", "predictive", "hint"].includes(key) ? CONTRAST.comment : CONTRAST.syntax;
    assert.ok(contrast(rgb(style.color!), surface) >= minimum - 0.05, `${key} ${style.color}`);
  }
  assert.equal(syntax.string.color, "#ce9178", "a colour that already reads is untouched");
  assert.equal(syntax.comment.font_style, "italic");
  assert.notEqual(syntax.keyword.color, syntax.string.color);
  assert.equal(syntax["keyword.operator"].color, syntax.keyword.color, "operators fall back to the keyword rule");
});

test("unmatched roles use the theme's default text, never another palette's colours", () => {
  const mapped = mapVsCodeTheme(theme({ colors: { "editor.background": "#101010" }, tokenColors: [{ scope: [], foreground: "#dddddd" }, { scope: ["string"], foreground: "#00ff00" }] }));
  assert.equal(mapped.syntax.syntax.function.color, "#dddddd");
  assert.equal(mapped.syntax.syntax.string.color, "#00ff00");
});

test("scope resolution follows TextMate precedence", () => {
  const rules = [
    { scope: ["keyword"], foreground: "#111111" },
    { scope: ["keyword.control"], foreground: "#222222" },
    { scope: ["keyword.control"], foreground: "#333333", fontStyle: "bold" },
    { scope: ["source.css entity.name.tag"], foreground: "#444444" },
    { scope: ["-comment"], foreground: "#555555" },
    { scope: [], foreground: "#666666" },
  ];
  assert.deepEqual(resolveScope(rules, "keyword.control.flow"), { foreground: "#333333", fontStyle: "bold" }, "the longest selector, then the later rule");
  assert.equal(resolveScope(rules, "keyword.other").foreground, "#111111");
  assert.equal(resolveScope(rules, "entity.name.tag.css").foreground, "#444444", "an ancestor selector is judged by its last part");
  assert.equal(resolveScope(rules, "comment").foreground, undefined, "exclusions and the default rule never match");
  assert.equal(resolveScope(rules, "keywordx").foreground, undefined, "a prefix must end at a dot");
});

test("terminal colours: theme palette is guarded and others stay Sirus's", () => {
  const mapped = mapVsCodeTheme(dimDark());
  const background = rgb(mapped.terminal.background!);
  assert.ok(contrast(rgb(mapped.terminal.foreground!), background) >= CONTRAST.primary - 0.05);
  assert.ok(contrast(rgb(mapped.terminal.blue!), background) >= CONTRAST.ansi - 0.05);
  assert.ok(contrast(rgb(mapped.terminal.red!), background) >= CONTRAST.ansi - 0.05);
  assert.equal(mapped.terminal.green, undefined, "colours the theme does not define are left to Sirus");
  const selection = mapVsCodeTheme(theme({ colors: { "editor.background": "#101010", "terminal.selectionBackground": "#ffffff" } })).terminal.selectionBackground!;
  assert.match(selection, /^rgba\(255,255,255,0\.4\)$/, "an opaque selection is capped so the text stays visible");
});

test("terminalAppearance uses the active theme, keeps glass alpha and guards Sirus's own ANSI colours", () => {
  const dark = dimDark();
  const settings = mergeSettings({ theme: "dark", vscodeThemes: [dark], darkVscodeTheme: dark.id });
  const appearance = terminalAppearance(settings, { translucency: true, dockIcon: true });
  assert.equal(appearance.background, mapVsCodeTheme(dark).terminal.background);
  assert.equal(appearance.cursorAccent, appearance.background);
  const glass = terminalAppearance(mergeSettings({ ...settings, darkWindowTranslucent: true }), { translucency: true, dockIcon: true });
  assert.equal(glass.background, `${appearance.background}00`);
  assert.equal(glass.cursorAccent, appearance.background, "reverse video keeps the theme colour");
  for (const name of ["green", "yellow", "cyan", "brightBlack"] as const) assert.ok(contrast(rgb(appearance[name]), rgb(appearance.background)) >= CONTRAST.ansi - 0.05, name);
  const plain = terminalAppearance(mergeSettings({ theme: "dark" }));
  assert.equal(plain.background, "#0c0c0c");
  assert.equal(plain.red, "#e5604d");
});

test("guardAnsi lowers the floor only for the extreme colour of each palette", () => {
  const darkOut = guardAnsi({ black: "#101010", white: "#101010" }, ["#0c0c0c"], "dark");
  assert.ok(contrast(rgb(darkOut.black!), rgb("#0c0c0c")) >= CONTRAST.ansiExtreme - 0.05);
  assert.ok(contrast(rgb(darkOut.black!), rgb("#0c0c0c")) < CONTRAST.ansi, "black may sit near a dark background");
  assert.ok(contrast(rgb(darkOut.white!), rgb("#0c0c0c")) >= CONTRAST.ansi - 0.05);
  const lightOut = guardAnsi({ white: "#f0f0f0" }, ["#ffffff"], "light");
  assert.ok(contrast(rgb(lightOut.white!), rgb("#ffffff")) >= CONTRAST.ansiExtreme - 0.05);
});

test("ensureContrast keeps the hue and ends at white or black when nothing else works", () => {
  const lifted = ensureContrast(rgb("#003366"), rgb("#101010"), 4.5);
  assert.ok(contrast(lifted, rgb("#101010")) >= 4.5);
  assert.ok(lifted.b > lifted.r, "still bluish");
  assert.deepEqual(ensureContrast(rgb("#777777"), rgb("#808080"), 21), { r: 0, g: 0, b: 0, a: 1 }, "an impossible floor ends at black on a mid backdrop");
  assert.equal(ensureContrast(rgb("#ffffff"), rgb("#000000"), 7).r, 255, "already readable colours are untouched");
});

test("colour parsing accepts hex only", () => {
  assert.deepEqual(parseColor("#abc"), { r: 170, g: 187, b: 204, a: 1 });
  assert.equal(parseColor("#11223380")?.a.toFixed(2), "0.50");
  for (const bad of ["red", "#12", "#12345", "rgb(1,2,3)", "", null, undefined]) assert.equal(parseColor(bad as never), null);
});

// ---------------------------------------------------------------------------------------------

test("storage validation drops malformed themes and bounds the list", () => {
  const good = theme({ colors: { "editor.background": "#101010" }, tokenColors: [{ scope: ["comment"], foreground: "#777777", fontStyle: "italic" }] });
  const normalized = normalizeVsCodeThemes([
    good,
    { ...good, id: "evil" },
    { ...good, id: id(), kind: "purple" },
    { ...good, id: id(), name: "" },
    { ...good, id: id(), name: "x".repeat(81) },
    { ...good },
    "string",
    null,
  ]);
  assert.deepEqual(normalized.map((item) => item.id), [good.id], "bad ids, kinds and names are dropped, and duplicate ids collapse");
  assert.deepEqual(normalizeVsCodeThemes("nope"), []);
  const many = Array.from({ length: MAX_INSTALLED_THEMES + 10 }, () => theme());
  assert.equal(normalizeVsCodeThemes(many).length, MAX_INSTALLED_THEMES);
});

test("storage validation cleans colours, scopes and font styles", () => {
  const [clean] = normalizeVsCodeThemes([theme({
    colors: { "editor.background": "red", foreground: "#ABCDEF", "bad key!": "#000000" } as never,
    tokenColors: [
      { scope: ["comment", "<script>", "x".repeat(200)], foreground: "#123456", fontStyle: "bold nonsense" },
      { scope: ["string"], foreground: "javascript:1" },
      { scope: ["number"], foreground: "#112233" },
    ],
  })]);
  assert.deepEqual(clean.colors, {}, "only lowercase #rrggbb[aa] values with sane keys survive (the back end already lowercases)");
  assert.equal(clean.tokenColors.length, 2);
  assert.deepEqual(clean.tokenColors[0], { scope: ["comment"], foreground: "#123456", fontStyle: "bold" });
});

test("the active theme must be installed and made for that palette", () => {
  const dark = theme({ kind: "dark" });
  const light = theme({ kind: "light" });
  assert.equal(normalizeActiveTheme(dark.id, [dark, light], "dark"), dark.id);
  assert.equal(normalizeActiveTheme(dark.id, [dark, light], "light"), null);
  assert.equal(normalizeActiveTheme("vsc-missing", [dark], "dark"), null);
  assert.equal(normalizeActiveTheme(42, [dark], "dark"), null);
  const settings = mergeSettings({ vscodeThemes: [dark, light], darkVscodeTheme: light.id, lightVscodeTheme: light.id });
  assert.equal(settings.darkVscodeTheme, null);
  assert.equal(settings.lightVscodeTheme, light.id);
  assert.equal(activeVsCodeTheme(settings, "light")?.id, light.id);
  assert.equal(activeVsCodeTheme(settings, "dark"), null);
});

test("removing a theme from settings clears a stale selection on load", () => {
  const dark = theme({ kind: "dark" });
  const settings = mergeSettings({ vscodeThemes: [], darkVscodeTheme: dark.id });
  assert.equal(settings.darkVscodeTheme, null);
});

test("Default (Sirus) resets the selection but keeps installed themes", () => {
  const dark = theme({ kind: "dark" });
  const settings = mergeSettings({ vscodeThemes: [dark], darkVscodeTheme: dark.id });
  assert.equal(settings.darkVscodeTheme, dark.id);
  const reset = resetAppearanceSettings(settings);
  assert.equal(reset.darkVscodeTheme, null);
  assert.equal(reset.lightVscodeTheme, null);
  assert.equal(reset.vscodeThemes.length, 1);
});

// ---------------------------------------------------------------------------------------------

function fakeRoot() {
  const props = new Map<string, string>();
  return { props, dataset: {} as Record<string, string | undefined>, style: { setProperty: (name: string, value: string) => props.set(name, value), removeProperty: (name: string) => { props.delete(name); } } } as unknown as HTMLElement & { props: Map<string, string> };
}

test("applying a theme sets the palette tokens and clearing it removes every one", () => {
  const root = fakeRoot();
  const source = theme({ colors: { "editor.background": "#101010", foreground: "#eeeeee" } });
  applyThemeTokens(root, source);
  for (const name of THEME_TOKEN_NAMES) if (name !== "--switch-track-on") assert.ok(root.props.has(name), name);
  assert.equal(root.dataset.vscodeTheme, source.id);
  applyThemeTokens(root, null);
  assert.equal(root.props.size, 0);
  assert.equal(root.dataset.vscodeTheme, undefined);
});

test("the code highlighter gets a uniquely named palette that changes with its content", () => {
  const a = importedSyntaxFor(mapVsCodeTheme(theme({ colors: { "editor.background": "#101010" }, tokenColors: [{ scope: ["string"], foreground: "#00ff00" }] })));
  const sameId = theme({ colors: { "editor.background": "#101010" }, tokenColors: [{ scope: ["string"], foreground: "#ff0000" }] });
  const b = importedSyntaxFor(mapVsCodeTheme(sameId));
  assert.match(a.name, /^sirus-vscode-vsc-[0-9a-f]{16}-[0-9a-f]{8}$/);
  assert.notEqual(a.name, b.name);
  assert.equal(a.zed.appearance, "dark");
  assert.ok(a.zed.style.syntax.keyword.color);
});
