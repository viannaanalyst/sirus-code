import test from "node:test";
import assert from "node:assert/strict";
import { catalogModels, latestModelChoices, modelDisplayName, pickerModelChoices, providerModelChoices, visibleModels } from "../src/lib/model-registry.ts";
import { defaultSettings } from "../src/lib/settings.ts";
import type { ProviderModelList } from "../src/client/types.ts";
import { AGENT_PROVIDER_IDS } from "../src/client/types.ts";

test("model presentation omits provider/router namespaces for every provider without changing native IDs", () => {
  for (const provider of AGENT_PROVIDER_IDS) {
    const id = `${provider}::openrouter/deepseek/deepseek-v4.1-flash`;
    assert.equal(modelDisplayName(provider, id), "deepseek-v4.1-flash");
    assert.equal(id, `${provider}::openrouter/deepseek/deepseek-v4.1-flash`);
    assert.equal(modelDisplayName(provider, "DeepSeek V4.1 Flash"), "DeepSeek V4.1 Flash");
  }
  assert.equal(modelDisplayName("opencode", "opencode-go/deepseek-v4.1-flash"), "deepseek-v4.1-flash");
  assert.equal(modelDisplayName("cursor", "cursor/Claude Sonnet 5.5 Max", ["cursor/Claude Sonnet 5.5 Low", "cursor/Claude Sonnet 5.5 Max"]), "Claude Sonnet 5.5");
});

test("model selection preserves provider identity, availability and favorites; retired per-model switches are ignored", () => {
  const catalog = (provider: "codex" | "cursor"): ProviderModelList => ({ provider, source: "cli", note: "", models: [
    { id: "same-model", displayName: "Same model", availability: "available" },
    { id: "disabled", displayName: "Disabled", availability: "available" },
    { id: "missing", displayName: "Missing", availability: "unavailable" },
    { id: "alias", displayName: "Unknown alias", availability: "unknown" },
  ] });
  const catalogs = { codex: catalog("codex"), cursor: catalog("cursor") };
  const settings = { ...defaultSettings, favoriteModels: ["cursor::same-model"], disabledModels: ["codex::disabled", "cursor::disabled"] };
  const rows = visibleModels(catalogs, settings, "same");
  assert.deepEqual(rows.map((row) => `${row.provider}::${row.model.id}`), ["cursor::same-model", "codex::same-model"]);
  assert.deepEqual(visibleModels(catalogs, { ...settings, disabledProviders: ["cursor"] }, "").map((row) => row.model.id).sort(), ["disabled", "same-model"]);
  assert.equal(visibleModels(catalogs, settings, "no such model").length, 0);
});

const cursorCatalog: ProviderModelList = { provider: "cursor", source: "cli", note: "", models: [
  { id: "claude-sonnet-5-thinking-xhigh", displayName: "Claude Sonnet 5 1M Extra High Thinking", availability: "available" },
  { id: "claude-sonnet-5-high", displayName: "Claude Sonnet 5 1M", availability: "available" },
  { id: "claude-sonnet-5-medium", displayName: "Claude Sonnet 5 1M Medium", availability: "available" },
  { id: "claude-4.6-sonnet-medium", displayName: "Claude Sonnet 4.6 1M", availability: "available" },
  { id: "gpt-5.4-mini-medium", displayName: "GPT-5.4 Mini", availability: "available" },
  { id: "gpt-5.6-sol-high", displayName: "GPT-5.6 Sol 1M High", availability: "unavailable" },
] };

test("provider pickers and Settings put newer model generations first without changing saved IDs", () => {
  const cursor: ProviderModelList = { provider: "cursor", source: "cli", note: "", models: [
    { id: "claude-opus-5-high", displayName: "Claude Opus 5 1M", availability: "available" },
    { id: "claude-sonnet-5-10", displayName: "Claude Sonnet 5.10", availability: "available" },
    { id: "claude-opus-5-5-high", displayName: "Claude Opus 5.5 1M", availability: "available" },
    { id: "claude-sonnet-5-9", displayName: "Claude Sonnet 5.9", availability: "available" },
    { id: "gpt-5.4", displayName: "GPT-5.4", availability: "available" },
    { id: "gpt-6.1-sol", displayName: "GPT-6.1-Sol", availability: "available" },
    { id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini", availability: "available" },
  ] };
  const settings = { ...defaultSettings, favoriteModels: ["cursor::claude-opus-5-high"] };
  const choices = providerModelChoices({ cursor }, settings, "cursor", "claude-opus-5-high", "");
  assert.deepEqual(choices.filter((row) => row.brand === "claude").map((row) => row.model.id),
    ["claude-sonnet-5-10", "claude-sonnet-5-9", "claude-opus-5-5-high", "claude-opus-5-high"]);
  assert.deepEqual(choices.filter((row) => row.brand === "openai").map((row) => row.model.id),
    ["gpt-6.1-sol", "gpt-5.4", "gpt-5.4-mini"]);
  assert.equal(choices.find((row) => row.model.id === "claude-opus-5-high")?.favorite, true);
  const settingsModels = catalogModels({ cursor }, settings).filter((row) => row.brand === "claude");
  assert.equal(settingsModels[0].model.id, "claude-sonnet-5-10");
  assert.equal(providerModelChoices({ cursor }, settings, "cursor", null, "opus")[0].model.id, "claude-opus-5-5-high");
  assert.equal(cursor.models[0].id, "claude-opus-5-high");
});

test("version ordering separates unknown model families and ignores capacity and date suffixes", () => {
  const opencode: ProviderModelList = { provider: "opencode", source: "cli", note: "", models: [
    { id: "qwen-old", displayName: "Qwen 2.5 70B", availability: "available" },
    { id: "kimi-old", displayName: "Kimi K2", availability: "available" },
    { id: "qwen-new", displayName: "Qwen 3.5 7B", availability: "available" },
    { id: "kimi-new", displayName: "Kimi K2.5", availability: "available" },
    { id: "claude-unversioned", displayName: "Claude Sonnet 20261001 1M", availability: "available" },
    { id: "claude-versioned", displayName: "Claude Sonnet 5.5 200K", availability: "available" },
    { id: "claude-date", displayName: "Claude Sonnet 2026-10-01", availability: "available" },
    { id: "anthropic/claude-opus-5-6", displayName: "anthropic/claude-opus-5-6", availability: "available" },
  ] };
  const ids = providerModelChoices({ opencode }, defaultSettings, "opencode", null, "").map((row) => row.model.id);
  assert.deepEqual(ids, ["anthropic/claude-opus-5-6", "claude-versioned", "claude-date", "claude-unversioned", "kimi-new", "kimi-old", "qwen-new", "qwen-old"]);
});

test("Cursor picker groups real presets by clean model name and keeps exact current ID", () => {
  const rows = providerModelChoices({ cursor: cursorCatalog }, defaultSettings, "cursor", null, "");
  assert.equal(rows.length, 3);
  const sonnet = rows.find((row) => row.displayName === "Claude Sonnet 5")!;
  assert.equal(sonnet.model.id, "claude-sonnet-5-high");
  assert.equal(sonnet.variantIds.length, 3);
  assert.equal(cursorCatalog.models[0].displayName, "Claude Sonnet 5 1M Extra High Thinking");
  const current = providerModelChoices({ cursor: cursorCatalog }, defaultSettings, "cursor", "claude-sonnet-5-thinking-xhigh", "sonnet 5");
  assert.equal(current.length, 1);
  assert.equal(current[0].model.id, "claude-sonnet-5-thinking-xhigh");
  assert.equal(providerModelChoices({ cursor: cursorCatalog }, defaultSettings, "cursor", null, "thinking")[0].model.id, "claude-sonnet-5-high");
});

test("Cursor prefers native parameter controls for new selection while preserving saved preset identity", () => {
  const catalog: ProviderModelList = { ...cursorCatalog, models: [...cursorCatalog.models,
    { id: "claude-sonnet-5", displayName: "Claude Sonnet 5", availability: "available", parameterized: true, effortLevels: ["low", "high"], fastMode: true },
  ] };
  const settings = { ...defaultSettings, favoriteModels: ["cursor::claude-sonnet-5-thinking-xhigh"] };
  const choices = (current: string | null) => providerModelChoices({ cursor: catalog }, settings, "cursor", current, "sonnet 5")[0];
  assert.equal(choices(null).model.id, "claude-sonnet-5");
  assert.equal(choices(null).favorite, true);
  assert.equal(choices("claude-sonnet-5-thinking-xhigh").model.id, "claude-sonnet-5-thinking-xhigh");
  assert.equal(providerModelChoices({ cursor: catalog }, { ...settings, disabledModels: ["cursor::claude-sonnet-5"] }, "cursor", null, "sonnet 5")[0].model.id, "claude-sonnet-5");
});

test("picker is scoped by provider and never groups another provider's equal display names", () => {
  const codex: ProviderModelList = { provider: "codex", source: "cli", note: "", models: [
    { id: "first", displayName: "GPT", availability: "available" },
    { id: "second", displayName: "GPT", availability: "available" },
  ] };
  const catalogs = { cursor: cursorCatalog, codex };
  assert.ok(providerModelChoices(catalogs, defaultSettings, "cursor", null, "").every((row) => row.provider === "cursor"));
  assert.deepEqual(providerModelChoices(catalogs, defaultSettings, "codex", null, "").map((row) => row.model.id), ["first", "second"]);
  assert.equal(providerModelChoices(catalogs, { ...defaultSettings, disabledProviders: ["cursor"] }, "cursor", null, "").length, 0);
});

test("grouped choices honor variant favorites and keep every variant", () => {
  const settings = { ...defaultSettings, favoriteModels: ["cursor::claude-sonnet-5-thinking-xhigh", "cursor::claude-sonnet-5-medium"], disabledModels: ["cursor::claude-sonnet-5-high"] };
  const rows = providerModelChoices({ cursor: cursorCatalog }, settings, "cursor", "claude-sonnet-5-high", "");
  assert.equal(rows[0].displayName, "Claude Sonnet 5");
  assert.equal(rows[0].favorite, true);
  assert.ok(rows[0].favoriteModelIds.includes("claude-sonnet-5-thinking-xhigh"));
  assert.equal(rows[0].favoriteModelIds.length, 2);
  assert.equal(rows[0].variantIds.includes("claude-sonnet-5-high"), true);
  const current = providerModelChoices({ cursor: cursorCatalog }, { ...settings, disabledModels: [] }, "cursor", "claude-sonnet-5-high", "")[0];
  assert.equal(current.model.id, "claude-sonnet-5-high");
  assert.equal(current.favorite, true);
});

test("presentation removes only Cursor preset suffixes and preserves model families and versions", () => {
  for (const name of ["GPT-5.4 Mini", "Gemini 3.8 Flash", "GPT-5.6 Sol", "Kimi K3 Max", "Claude Sonnet 4.6"]) assert.equal(modelDisplayName("cursor", name), name);
  assert.equal(modelDisplayName("cursor", "Grok 4.7\u200B Extra High Fast"), "Grok 4.7");
  assert.equal(modelDisplayName("cursor", "Claude Fable 5 1M Thinking (NO ZDR)"), "Claude Fable 5");
  assert.equal(modelDisplayName("cursor", "Auto (default)"), "Auto");
  assert.equal(modelDisplayName("cursor", "Claude Sonnet 5 1M Max Thinking"), "Claude Sonnet 5");
  assert.equal(modelDisplayName("cursor", "Claude Sonnet 5.5  Max", ["Claude Sonnet 5.5 Low", "Claude Sonnet 5.5 Max"]), "Claude Sonnet 5.5");
  assert.equal(modelDisplayName("cursor", "Gemini 3.6 Flash Minimal"), "Gemini 3.6 Flash");
  assert.equal(modelDisplayName("codex", "GPT Thinking"), "GPT Thinking");
});

test("every model of an enabled provider is offered, ignoring retired per-model switches", () => {
  const catalog: ProviderModelList = { provider: "cursor", source: "cli", note: "", models: [
    { id: "claude-sonnet", displayName: "Claude Sonnet", availability: "available" },
    { id: "gpt-6.1-sol", displayName: "GPT", availability: "unknown" },
  ] };
  const rows = catalogModels({ cursor: catalog }, { ...defaultSettings, disabledModels: ["cursor::claude-sonnet"], favoriteModels: ["cursor::claude-sonnet"] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].brand, "claude");
  assert.equal(visibleModels({ cursor: catalog }, { ...defaultSettings, disabledModels: ["cursor::claude-sonnet"] }, "").some(row => row.model.id === "claude-sonnet"), true);
  assert.equal(rows[0].favorite, true);
  assert.equal(rows[0].capabilities, null);
  assert.equal(rows[1].brand, "openai");
  assert.equal(rows[1].model.availability, "unknown");
  assert.equal(catalogModels({ cursor: catalog }, { ...defaultSettings, disabledProviders: ["cursor"] })[1].providerEnabled, false);
});

test("icon rail isolates provider catalogs and global favorites retain provider-qualified identity", () => {
  const codex: ProviderModelList = { provider: "codex", source: "cli", note: "", models: [
    { id: "same", displayName: "Same model", availability: "available" },
    { id: "hidden", displayName: "Disabled model", availability: "available" },
  ] };
  const claude: ProviderModelList = { provider: "claude", source: "cli", note: "", models: [
    { id: "same", displayName: "Same model", availability: "available" },
  ] };
  const settings = { ...defaultSettings, favoriteModels: ["codex::same", "claude::same"], disabledModels: ["codex::hidden"] };
  const catalogs = { codex, claude };
  const installed = ["codex", "claude"] as const;
  const favorites = pickerModelChoices(catalogs, settings, installed, "favorites", "codex", "same", "");
  assert.deepEqual(favorites.map((row) => `${row.provider}::${row.model.id}`), ["codex::same", "claude::same"]);
  assert.deepEqual(pickerModelChoices(catalogs, settings, installed, "claude", "codex", "same", "").map((row) => row.provider), ["claude"]);
  assert.equal(pickerModelChoices(catalogs, settings, ["codex"], "claude", "codex", "same", "").length, 0);
  assert.deepEqual(pickerModelChoices(catalogs, { ...settings, disabledProviders: ["claude"] }, installed, "favorites", "codex", "same", "").map((row) => row.provider), ["codex"]);
});

test("browsing another provider does not use its equal model ID as a selected Cursor preset", () => {
  const settings = { ...defaultSettings, favoriteModels: ["cursor::claude-sonnet-5-medium"] };
  const rows = pickerModelChoices({ cursor: cursorCatalog }, settings, ["cursor"], "cursor", "claude", "claude-sonnet-5-thinking-xhigh", "sonnet 5");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].model.id, "claude-sonnet-5-medium");
  const selected = pickerModelChoices({ cursor: cursorCatalog }, settings, ["cursor"], "favorites", "cursor", "claude-sonnet-5-thinking-xhigh", "sonnet 5");
  assert.equal(selected[0].model.id, "claude-sonnet-5-thinking-xhigh");
  assert.equal(pickerModelChoices({}, settings, ["cursor"], "cursor", "cursor", null, "").length, 0);
});

test("pickers offer the newest generation of each model line; favorites, the current model and searches keep older ones", () => {
  const claude: ProviderModelList = { provider: "claude", source: "cli", note: "", models: [
    { id: "claude-opus-5-5", displayName: "Opus 5.5", availability: "available" },
    { id: "claude-opus-4-6", displayName: "Opus 4.6", availability: "available" },
    { id: "claude-sonnet-5-5", displayName: "Sonnet 5.5", availability: "available" },
    { id: "claude-sonnet-4-6", displayName: "Sonnet 4.6", availability: "available" },
    { id: "claude-haiku-4-5", displayName: "Haiku 4.5", availability: "available" },
    { id: "default", displayName: "Default (recommended)", availability: "available" },
  ] };
  const codex: ProviderModelList = { provider: "codex", source: "cli", note: "", models: [
    { id: "gpt-5.5", displayName: "GPT-5.5", availability: "available" },
    { id: "gpt-5.4", displayName: "GPT-5.4", availability: "available" },
    { id: "gpt-5.4-mini", displayName: "GPT-5.4-mini", availability: "available" },
  ] };
  const ids = (provider: "claude" | "codex", current: string | null, query = "", settings = defaultSettings) => pickerModelChoices({ claude, codex }, settings, ["claude", "codex"], provider, provider, current, query).map((row) => row.model.id);
  assert.deepEqual(ids("claude", null), ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"]);
  assert.deepEqual(ids("codex", null), ["gpt-5.5", "gpt-5.4-mini"]);
  assert.ok(ids("claude", "claude-opus-4-6").includes("claude-opus-4-6"), "the selected model stays reachable");
  assert.ok(ids("claude", null, "4.6").includes("claude-sonnet-4-6"), "searching reaches older generations");
  assert.ok(ids("claude", null, "", { ...defaultSettings, favoriteModels: ["claude::claude-sonnet-4-6"] }).includes("claude-sonnet-4-6"), "favorites stay listed");
  assert.ok(ids("claude", "default").includes("default"), "a selected CLI default stays visible");
  assert.equal(latestModelChoices([], null, "").length, 0);
});

test("native model ids read like the picker", async () => {
  const { readableModelId } = await import("../src/lib/model-registry.ts");
  assert.equal(readableModelId("claude-haiku-4-5-20251001"), "Haiku 4.5");
  assert.equal(readableModelId("claude-opus-5"), "Opus 5");
  assert.equal(readableModelId("gpt-6-luna"), "gpt-6-luna");
  assert.equal(readableModelId("some-model-20260101"), "some-model");
});
