import { test } from "node:test";
import assert from "node:assert/strict";
import { SETTINGS_INDEX } from "../src/lib/settings-index.ts";
import { searchSettings } from "../src/lib/settings-search.ts";
import { translate } from "../src/i18n/index.ts";

test("settings search finds rows in Portuguese and English, accents ignored", () => {
  const pt = (key: string) => translate("pt-BR", key);
  const page = (section: string) => section;
  const fundo = searchSettings(SETTINGS_INDEX, "fundo do chat", pt, page);
  assert.ok(fundo.length > 0 && fundo[0].entry.section === "appearance");
  assert.ok(searchSettings(SETTINGS_INDEX, "animacoes", pt, page).some((match) => match.entry.section === "appearance"));
  assert.ok(searchSettings(SETTINGS_INDEX, "chat background", (key) => translate("en", key), page).length > 0);
  assert.equal(searchSettings(SETTINGS_INDEX, "   ", pt, page).length, 0);
});

test("the settings index is current", async () => {
  const { readFileSync } = await import("node:fs");
  for (const entry of SETTINGS_INDEX) {
    const files = ["AppearanceSettings", "ChatBehaviorSettings", "ComputerSettings", "ConnectionsSettings", "GeneralSettings", "NotificationSettings", "McpSettings", "SkillsSettings", "KeybindingsSettings", "SettingsPanels"]
      .map((name) => readFileSync(new URL(`../src/components/settings/${name}.tsx`, import.meta.url), "utf8")).join("\n");
    assert.ok(files.includes(`"${entry.title}"`), `${entry.title} is still a settings row (run node scripts/build-settings-index.mjs)`);
  }
});
